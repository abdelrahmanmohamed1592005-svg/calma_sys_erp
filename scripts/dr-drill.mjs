// تدريب نسخ احتياطي واسترجاع (في قاعدة محلية معزولة، مش Supabase): بيانات مالية تركيبية ← pg_dump ← استرجاع في قاعدة جديدة
// ← مقارنة بصمة الأرقام ← عملية دفع جديدة ← reconcile. الأزمنة بتتقاس فعليًا. الاستخدام: E2E_PG_ADMIN_URL=... node scripts/dr-drill.mjs
import pg from "pg";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

const ADMIN = process.env.E2E_PG_ADMIN_URL;
if (!ADMIN) throw new Error("حدد E2E_PG_ADMIN_URL");
const url = (db) => { const u = new URL(ADMIN); u.pathname = "/" + db; return u.toString(); };
const SRC = `calma_dr_src_${process.pid}`, DST = `calma_dr_dst_${process.pid}`;
const admin = new pg.Client({ connectionString: ADMIN }); await admin.connect();
const t0 = () => performance.now(); const sec = (t) => +((performance.now() - t) / 1000).toFixed(2);
const out = { startedAt: new Date().toISOString(), steps: {} };
const sqlfile = (db, f) => execFileSync("psql", [url(db), "-v", "ON_ERROR_STOP=1", "-q", "-f", f], { env: { ...process.env, PGOPTIONS: "-c client_min_messages=warning" } });
try {
  await admin.query(`create database ${SRC}`);
  sqlfile(SRC, "supabase/tests/stub_supabase.sql"); sqlfile(SRC, "supabase/schema.sql");
  const src = new pg.Pool({ connectionString: url(SRC), max: 4, options: "-c timezone=UTC" }); src.on("error", () => {});
  const ids = {};
  for (const [u, r] of [["gm1", "gm"], ["res1", "reservations"], ["st1", "staff"], ["acc1", "accounts"]]) {
    ids[u] = randomUUID();
    await src.query("insert into auth.users(id,email) values ($1,$2)", [ids[u], `${u}@calma.internal`]);
    await src.query("insert into profiles(id,username,name,role) values ($1,$2,$3,$4)", [ids[u], u, u, r]);
  }
  const as = async (pool, user, fn) => { const c = await pool.connect(); try { await c.query("begin"); await c.query("select set_config('request.jwt.claim.sub',$1,true)", [ids[user]]); await c.query("set local role authenticated"); const r = await fn(c); await c.query("commit"); return r; } catch (e) { await c.query("rollback").catch(() => {}); throw e; } finally { c.release(); } };
  const today = (await src.query("select hotel_today()::text d")).rows[0].d;
  const rooms = (await src.query("select number from rooms order by number limit 12")).rows.map((r) => r.number);
  // --- بيانات تركيبية: ٢٤٠ حجز، دفعات (كاش/فيزا/تحويل)، إلغاء + رد، كافيتيريا استاف
  const tSeed = t0();
  let n = 0, paid = 0, errors = [];
  const claimOnce = async () => {
    await src.query("insert into shift_claims(date,shift_key,username,name) values ($1,'morning','st1','st1') on conflict do nothing", [today]);
    await src.query("insert into shift_records(date,shift_key,staff_name,staff_username) values ($1,'morning','st1','st1') on conflict do nothing", [today]);
    return "morning";
  };
  const key = await claimOnce();
  if (!key) throw new Error("مفيش شيفت مفتوح للموظف التركيبي");
  for (let day = 0; day < 20; day++) for (const room of rooms) {
    const ci = (await src.query("select ($1::date + $2::int)::text d", [today, day * 2 + 1])).rows[0].d;
    const co = (await src.query("select ($1::date + $2::int)::text d", [today, day * 2 + 2])).rows[0].d;
    const b = await as(src, "res1", (c) => c.query("insert into bookings(room,guest_name,checkin,checkout,price_night,total_room,currency,pax) values ($1,$2,$3,$4,100,100,'USD',1) returning id", [room, `Drill ${++n}`, ci, co]));
    const id = b.rows[0].id;
    const mode = n % 6;
    try {
      if (mode === 0) { /* غير مدفوع */ }
      else if (mode === 1 || mode === 2) { await as(src, "st1", (c) => c.query("select record_booking_payment($1,100,$2,$3::jsonb,null,null)", [id, mode === 1 ? "كاش" : "فيزا", JSON.stringify(mode === 2 ? { senderNumber: "4242" } : {})])); paid += 100; }
      else if (mode === 3) { await as(src, "st1", (c) => c.query("select record_booking_payment($1,40,'كاش','{}'::jsonb,null,null)", [id])); await as(src, "st1", (c) => c.query("select record_booking_payment($1,60,'فيزا',$2::jsonb,null,null)", [id, JSON.stringify({ senderNumber: "1111" })])); paid += 100; }
      else if (mode === 4) { await as(src, "st1", (c) => c.query("select record_booking_payment($1,100,'كاش','{}'::jsonb,null,null)", [id])); paid += 100;
             await as(src, "res1", (c) => c.query("update bookings set status='ملغي' where id=$1", [id])); }   // مفيش رد فلوس: بتفضل في الفندق
      else { await as(src, "st1", (c) => c.query("select record_booking_payment_fx($1,5000,'EGP',50,'كاش')", [id])); paid += 100; }   // دفع بالجنيه بسعر صرف
    } catch (e) { errors.push(e.message.slice(0, 120)); }
  }
  for (let i = 0; i < 30; i++) { try { await as(src, "st1", (c) => c.query("select record_staff_cafeteria('Staff A', null, 'drill', 25, 'EGP', null, null)")); } catch (e) { errors.push("cafeteria: " + e.message.slice(0, 100)); break; } }
  out.steps.seed = { seconds: sec(tSeed), bookings: n, grossPaidUSD: paid, errors: [...new Set(errors)].slice(0, 5), shiftKey: key };

  const fingerprint = async (pool) => {
    const q = async (s) => (await pool.query(s)).rows;
    const counts = {}; for (const t of ["bookings", "shift_records", "shift_claims", "profiles", "staff_cafeteria", "activity_log", "rooms"]) counts[t] = +(await q(`select count(*) c from ${t}`))[0].c;
    const money = await q("select currency, sum(amount_paid)::numeric(14,2)::text paid, count(*) filter (where settled) settled, count(*) filter (where refund_pending) pending from bookings group by 1 order by 1");
    const ledger = await q("select (select sum((x->>'collectionAmt')::numeric) from shift_records s, jsonb_array_elements(s.rows) x where x->>'collectionAmt' ~ '^-?[0-9.]+$')::text led");
    const recon = fs.readFileSync("supabase/ops/reconcile.sql", "utf8");
    const rows = await q(recon);
    return { counts, money, ledger: ledger[0].led, reconcileErrors: rows.filter((r) => r.level === "خطأ").length, reconcileWarnings: rows.filter((r) => r.level !== "خطأ").length };
  };
  const fpSrc = await fingerprint(src);
  out.steps.srcFingerprint = fpSrc;

  const dump = `/tmp/calma-dr-${process.pid}.dump`;
  let t = t0();
  execFileSync("pg_dump", [url(SRC), "--no-owner", "--no-privileges", "--schema=public", "--schema=auth", "--format=custom", `--file=${dump}`]);
  out.steps.backup = { seconds: sec(t), bytes: fs.statSync(dump).size };

  await src.end();
  await admin.query(`drop database ${SRC} with (force)`);          // محاكاة فقد القاعدة الأصلية
  await admin.query(`create database ${DST}`);
  // المشروع الجديد بيجي بـ schema الـ auth + الأدوار من Supabase؛ محليًا بنركّب الـ stub الأول ثم نرجّع النسخة فوقه
  sqlfile(DST, "supabase/tests/stub_supabase.sql"); sqlfile(DST, "supabase/schema.sql");     // الخطوة ٢ في docs/BACKUP.md
  await (async () => { const c = new pg.Client({ connectionString: url(DST) }); await c.connect(); await c.query("truncate table public.rooms cascade"); await c.end(); })();   // خطوة ٤ في docs/BACKUP.md
  t = t0();
  let restoreWarn = "", restoreIgnored = "";
  try { execFileSync("pg_restore", ["--data-only", "--disable-triggers", "--no-owner", "-d", url(DST), dump], { stdio: ["ignore", "pipe", "pipe"] }); }
  catch (e) {
    // pg_dump/pg_restore أحدث من السيرفر (مثلاً عميل 17 وسيرفر 16) بيكتب في أول الملف "SET transaction_timeout = 0"
    // واللي السيرفر الأقدم مايعرفهوش. ده إعداد للجلسة بس ومالوش علاقة بالبيانات - بنسجّله ومانعتبرهوش فشل.
    // أي خطأ تاني (أو عدد أخطاء أكبر من الحالة دي) بيفضل فشل.
    const lines = String(e.stderr || e.message).split("\n").map((l) => l.trim()).filter(Boolean);
    const isBenign = (l) => /unrecognized configuration parameter "transaction_timeout"/.test(l) || /^Command was: SET transaction_timeout = 0;?$/.test(l);
    const benignErrors = lines.filter((l) => /unrecognized configuration parameter "transaction_timeout"/.test(l)).length;
    const ignoredCount = Number((lines.find((l) => /errors ignored on restore: \d+/.test(l)) || "").match(/(\d+)\s*$/)?.[1] || 0);
    const other = lines.filter((l) => !isBenign(l) && !/errors ignored on restore: \d+/.test(l));
    if (other.length === 0 && benignErrors > 0 && ignoredCount === benignErrors) restoreIgnored = lines.join(" | ");
    else restoreWarn = lines.slice(0, 6).join(" | ");
  }
  out.steps.restore = { seconds: sec(t), warnings: restoreWarn || null, ...(restoreIgnored ? { ignoredClientServerVersionNotice: restoreIgnored } : {}) };

  const dst = new pg.Pool({ connectionString: url(DST), max: 4, options: "-c timezone=UTC" }); dst.on("error", () => {});
  const fpDst = await fingerprint(dst);
  out.steps.dstFingerprint = fpDst;
  out.steps.fingerprintIdentical = JSON.stringify(fpSrc) === JSON.stringify(fpDst);

  // --- بعد الاسترجاع: تسجيل دخول (اختبار هوية)، قراءة، دفعة جديدة، reconcile
  const post = {};
  post.staffCanRead = (await as(dst, "st1", (c) => c.query("select count(*)::int n from bookings"))).rows[0].n;
  const free = (await dst.query("select id from bookings where amount_paid = 0 and status <> 'ملغي' limit 1")).rows[0]?.id;
  post.newPayment = "NOT RUN";
  if (free) {
    try { await dst.query("insert into shift_claims(date,shift_key,username,name) values ($1,$2,'st1','st1') on conflict do nothing", [today, key]); await dst.query("insert into shift_records(date,shift_key,staff_name,staff_username) values ($1,$2,'st1','st1') on conflict do nothing", [today, key]); } catch { /* موجود */ }
    try { await as(dst, "st1", (c) => c.query("select record_booking_payment($1,100,'كاش','{}'::jsonb,null,null)", [free])); post.newPayment = "OK"; } catch (e) { post.newPayment = "FAIL: " + e.message; }
  }
  post.lockStillEnforced = await as(dst, "st1", (c) => c.query("update bookings set amount_paid = 999 where id = $1", [free])).then(() => "FAIL (write allowed)", (e) => "OK: " + e.message.slice(0, 60));
  post.reconcileAfter = (await fingerprint(dst)).reconcileErrors;
  out.steps.postRestore = post;
  await dst.end();
  out.finishedAt = new Date().toISOString();
} catch (e) { out.fatal = String(e.message); console.error("FATAL:", e.message, e.where || ""); process.exitCode = 1;
} finally {
  await admin.query(`drop database if exists ${SRC} with (force)`).catch(() => {});
  await admin.query(`drop database if exists ${DST} with (force)`).catch(() => {});
  await admin.end();
}
fs.mkdirSync("evidence-out", { recursive: true });
const ps = out.steps.postRestore || {};
const ok = !out.fatal && out.steps.fingerprintIdentical === true && !out.steps.restore?.warnings && ps.newPayment === "OK" && String(ps.lockStillEnforced).startsWith("OK") && ps.reconcileAfter === 0 && out.steps.srcFingerprint?.reconcileErrors === 0;
out.passed = ok; if (!ok) process.exitCode = 1;
fs.writeFileSync("evidence-out/dr-drill.json", JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
