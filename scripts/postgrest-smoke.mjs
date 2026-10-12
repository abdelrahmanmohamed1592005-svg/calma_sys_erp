/* اختبار دخان على الطريق الحقيقي: supabase-js ← PostgREST ← Postgres بـ JWT حقيقي (auth.uid() من الـ claims).
   بيتشغّل بـ scripts/postgrest-smoke.sh اللي بيجهّز القاعدة وPostgREST وبوابة /rest/v1 زي Supabase. */
// Node 20 (CI) مفيهوش WebSocket مدمج وrealtime-js بيطلبه عند إنشاء الـ client؛ الاختبار ده مابيستخدمش realtime فبنحط بديل فاضي
import { createClient } from "@supabase/supabase-js";
class NoWS { close() {} }
import crypto from "node:crypto";
import { fetchAll } from "../src/data/page.js";
const secret = "super-secret-jwt-token-with-at-least-32-characters-long";
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (sub) => { const h = b64({ alg: "HS256", typ: "JWT" }), p = b64({ sub, role: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 }); return `${h}.${p}.${crypto.createHmac("sha256", secret).update(`${h}.${p}`).digest("base64url")}`; };
const client = (sub) => createClient("http://localhost:3001", jwt(sub), { realtime: { transport: NoWS }, auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${jwt(sub)}` } } });
const st = client("11111111-1111-1111-1111-111111111111"), res = client("22222222-2222-2222-2222-222222222222");
const ok = (c, m, extra) => { console.log(c ? "PASS" : "FAIL", m, c ? "" : JSON.stringify(extra)); if (!c) process.exitCode = 1; };
const today = new Date().toISOString().slice(0, 10);
const tomorrow = new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10);
let r = await st.from("bookings").insert({ room: 601, guest_name: "Real API", checkin: today, checkout: tomorrow, price_night: 100, total_room: 200, currency: "USD", extras: { laundry: 0, cafeteria: 30, tours: 0, pickup: 0 } }).select().single();
ok(!r.error, "insert booking via REST", r.error);
const id = r.data?.id;
// دفعة فيزا عبر RPC بنفس صيغة الواجهة
let p = await st.rpc("record_booking_payment", { p_booking: id, p_amount: 50, p_method: "فيزا", p_details: { senderName: "", senderNumber: "٤٢٤٢", ref: "" }, p_expected: null, p_note: "تحصيل" });
ok(!p.error && p.data.cafeteria === 30 && p.data.details.senderNumber === "4242", "visa payment rpc (cafeteria first, arabic last4)", p);
p = await st.rpc("record_booking_payment", { p_booking: id, p_amount: 9999, p_method: "كاش", p_details: {}, p_expected: null, p_note: "x" });
ok(p.error && /أكبر من المتبقي/.test(p.error.message), "overpay rejected with Arabic message", p);
p = await st.rpc("record_booking_payment", { p_booking: id, p_amount: 10, p_method: "فيزا", p_details: { senderNumber: "12" }, p_expected: null, p_note: "x" });
ok(p.error && /٤ أرقام/.test(p.error.message), "visa without 4 digits rejected", p);
// الاستاف
let s = await st.rpc("record_staff_cafeteria", { p_name: "Sara", p_username: null, p_desc: "coffee", p_amount: 40, p_currency: "EGP", p_method: null, p_details: null });
ok(!s.error && s.data.paid === false, "staff cafeteria later", s);
s = await st.rpc("settle_staff_cafeteria", { p_name: "Sara", p_username: null, p_currency: "EGP", p_amount: 15, p_method: "فودافون كاش", p_details: { senderName: "Sara", senderNumber: "01012345678" } });
ok(!s.error && s.data.left === 25, "settle partial", s);
// مدير الحجوزات: الغاء + رد
let c = await res.from("bookings").update({ status: "ملغي" }).eq("id", id).select().single();
ok(!c.error && c.data.refund_pending === true, "cancel opens refund request", c.error);
let d = await res.rpc("decide_booking_refund", { p_booking: id, p_decision: "refund", p_expected: null, p_method: "فيزا" });
ok(!d.error && d.data.amount === 50, "refund via real PostgREST", d);
// صلاحيات: الموظف مايقدرش يرد، anon مايقدرش ينادي الدوال
let bad = await st.rpc("decide_booking_refund", { p_booking: id, p_decision: "refund", p_expected: null, p_method: "كاش" });
ok(bad.error, "staff cannot decide refund", bad);
const anon = createClient("http://localhost:3001", "anon", { realtime: { transport: NoWS }, auth: { persistSession: false } });
const an = await fetch("http://localhost:3001/rest/v1/rpc/record_booking_payment", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ p_booking: id, p_amount: 1, p_method: "كاش" }) });
ok(an.status === 401 || an.status === 403 || an.status === 404, "anon cannot call payment rpc (status " + an.status + ")", await an.text());
const led = await st.from("shift_records").select("rows,cafeteria_rows").single();
const sum = (a) => a.reduce((x, y) => x + (Number(y.collectionAmt) || 0), 0);

console.log("ledger", JSON.stringify(led.data ? { room: sum(led.data.rows), cafe: sum(led.data.cafeteria_rows) } : led.error));

// حد Supabase (db-max-rows = 1000): ٢٥٠٠ حجز لازم يتجابوا كلهم بالصفحات، والاستعلام العادي بيتقصّ عند ١٠٠٠ من غير خطأ
{
  const { Client } = (await import("pg")).default;
  const admin = new Client({ connectionString: process.env.SMOKE_DB_URL }); await admin.connect();
  await admin.query(`insert into bookings(room, guest_name, checkin, checkout, price_night, total_room, currency)
    select 601 + (g % 16), 'Bulk ' || g, date '2020-01-01' + (g / 16), date '2020-01-01' + (g / 16) + 1, 10, 10, 'USD' from generate_series(0, 2499) g`);
  await admin.end();
  const plain = await st.from("bookings").select("id");
  ok(!plain.error && plain.data.length === 1000, "plain select is silently capped at 1000 (proves the cap is active)", plain.data?.length);
  const all = await fetchAll(() => st.from("bookings").select("*", { count: "exact" }).order("checkin", { ascending: false }).order("id"));
  ok(!all.error && all.data.length === 2500 + 1 && new Set(all.data.map((r) => r.id)).size === all.data.length, "fetchAll returns all 2501 rows with no duplicates", all.error || all.data?.length);
}
