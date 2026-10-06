/*
  جسر بين واجهة التطبيق (طلبات Supabase) وقاعدة Postgres حقيقية فيها schema.sql
  الفعلي: بيترجم طلبات REST (على طريقة PostgREST) والدخول وبعض الـ Edge Functions
  لـ SQL، وبينفّذ كل طلب في معاملة بدور المستخدم الحقيقي (anon / authenticated +
  هوية الجلسة) - يعني RLS والـ triggers والقيود بتتطبّق بالظبط زي Supabase.
  مش بديل عن اختبار على Supabase نفسه (PostgREST/GoTrue/Edge Functions الحقيقيين)،
  لكنه بيخلّي اختبار الواجهة + قاعدة البيانات مع بعض ممكن محليًا.
*/
import pg from "pg";
import { randomUUID } from "node:crypto";

// نفس تمثيل PostgREST: numeric كرقم، date كنص، timestamptz كنص ISO بدقة الميكروثانية
// (التطبيق بيستخدم updated_at في شرط الكتابة الآمنة من التعارض، فالدقة مهمة)
pg.types.setTypeParser(1700, (v) => parseFloat(v));
pg.types.setTypeParser(1082, (v) => v);
pg.types.setTypeParser(1184, (v) => v.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00"));

const IDENT = /^[a-z_][a-z0-9_]*$/;
const ident = (s) => { if (!IDENT.test(s)) throw new Error("bad identifier " + s); return `"${s}"`; };
const PK = { rooms: ["number"], room_overrides: ["room_number"], profiles: ["id"], bookings: ["id"], shift_records: ["date", "shift_key"], shift_claims: ["date", "shift_key"], activity_log: ["id"] };
const TABLES = Object.keys(PK);
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");

export function makeJwt(sub) {
  return `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub, role: "authenticated", aud: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
}
const subOf = (headers) => {
  const m = (headers["authorization"] || "").match(/^Bearer (.+)$/);
  if (!m) return null;
  try { return JSON.parse(Buffer.from(m[1].split(".")[1], "base64url").toString()).sub || null; } catch { return null; }
};
const param = (v) => (v !== null && typeof v === "object" ? JSON.stringify(v) : v);

export function makeBridge(pool, { log } = {}) {
  const calls = { rest: [], functions: [] };

  async function inTx(sub, fn) {
    const c = await pool.connect();
    try {
      await c.query("begin");
      await c.query(`set local role ${sub ? "authenticated" : "anon"}`);
      await c.query("select set_config('request.jwt.claim.sub', $1, true)", [sub || ""]);
      const out = await fn(c);
      await c.query("commit");
      return out;
    } catch (e) {
      await c.query("rollback").catch(() => {});
      throw e;
    } finally { c.release(); }
  }
  const sessionFor = (id, username) => ({
    access_token: makeJwt(id), token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: "r-" + id,
    user: { id, aud: "authenticated", role: "authenticated", email: `${username}@calma.internal`, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() },
  });
  const pgError = (e) => {
    const status = e.code === "23505" || e.code === "23P01" ? 409 : e.code === "42501" ? 403 : 400;
    return { status, body: { code: e.code || "XX000", message: e.message, details: e.detail || null, hint: e.hint || null } };
  };

  function filtersOf(params, startIdx) {
    const where = []; const vals = [];
    for (const [k, v] of params.entries()) {
      if (["select", "order", "limit", "offset", "on_conflict", "columns"].includes(k)) continue;
      const m = v.match(/^(eq|gte|lte|gt|lt|neq)\.(.*)$/);
      if (!m) continue;
      const op = { eq: "=", gte: ">=", lte: "<=", gt: ">", lt: "<", neq: "<>" }[m[1]];
      vals.push(m[2]);
      // من غير cast: Postgres بيستنتج نوع المعامل من العمود (تاريخ/وقت/رقم/uuid)
      where.push(`${ident(k)} ${op} $${startIdx + vals.length - 1}`);
    }
    return { where, vals };
  }

  async function handle({ method, url: rawUrl, headers, body }) {
    const url = new URL(rawUrl);
    const path = url.pathname;
    const json = (status, b, h = {}) => ({ status, body: b, headers: h });
    const adminQ = (sql, params) => pool.query(sql, params);

    // ---------------- Auth ----------------
    if (path === "/auth/v1/token") {
      const email = String(body?.email || "").toLowerCase();
      const r = await adminQ("select id from auth.users where email = $1 and password = $2", [email, body?.password]);
      if (!r.rows[0]) return json(400, { code: 400, error_code: "invalid_credentials", msg: "Invalid login credentials" });
      return json(200, sessionFor(r.rows[0].id, email.split("@")[0]));
    }
    if (path === "/auth/v1/signup") {
      const email = String(body.email).toLowerCase();
      const ex = await adminQ("select 1 from auth.users where email = $1", [email]);
      if (ex.rows[0]) return json(422, { code: 422, error_code: "user_already_exists", msg: "User already registered" });
      const id = randomUUID();
      await adminQ("insert into auth.users(id, email, password) values ($1, $2, $3)", [id, email, body.password]);
      return json(200, sessionFor(id, email.split("@")[0]));
    }
    if (path === "/auth/v1/logout") return { status: 204, body: undefined };
    if (path === "/auth/v1/user") {
      const sub = subOf(headers);
      const r = sub ? await adminQ("select id, email from auth.users where id = $1", [sub]) : { rows: [] };
      if (!r.rows[0]) return json(401, { msg: "invalid" });
      if (method === "PUT") { await adminQ("update auth.users set password = $2 where id = $1", [sub, body.password]); }
      return json(200, sessionFor(r.rows[0].id, r.rows[0].email.split("@")[0]).user);
    }

    // ------------- Edge Functions (محاكاة بنفس منطق الفنكشنز الحقيقية) -------------
    const fn = path.match(/^\/functions\/v1\/(.+)$/);
    if (fn) {
      calls.functions.push({ name: fn[1], body });
      const sub = subOf(headers);
      const caller = sub ? (await adminQ("select role, active from profiles where id = $1", [sub])).rows[0] : null;
      if (!caller || caller.role !== "gm" || !caller.active) return json(403, { error: "الصلاحية دي للمدير العام بس" });
      const pwOk = (p) => typeof p === "string" && p.length >= 8 && p.length <= 128 && /[A-Za-z]/.test(p) && /[0-9]/.test(p);
      if (fn[1] === "create-user") {
        const username = String(body.username || "").trim().toLowerCase();
        const name = String(body.name || "").trim().slice(0, 80);
        if (!/^[a-z0-9_]{3,30}$/.test(username)) return json(400, { error: "اسم المستخدم غير صالح" });
        if (!name) return json(400, { error: "الاسم مطلوب" });
        if (!["staff", "reservations", "accounts", "gm"].includes(body.role)) return json(400, { error: "دور غير معروف" });
        if (!pwOk(body.password)) return json(400, { error: "كلمة المرور ٨ حروف على الأقل" });
        const ex = await adminQ("select 1 from auth.users where email = $1", [`${username}@calma.internal`]);
        if (ex.rows[0]) return json(409, { error: "اسم المستخدم ده موجود بالفعل" });
        const id = randomUUID();
        await adminQ("insert into auth.users(id, email, password) values ($1, $2, $3)", [id, `${username}@calma.internal`, body.password]);
        await adminQ("insert into profiles(id, username, name, role, active) values ($1, $2, $3, $4, true)", [id, username, name, body.role]);
        return json(200, { success: true, data: { id, username, name, role: body.role, active: true } });
      }
      if (fn[1] === "reset-password") {
        const username = String(body.username || "").trim().toLowerCase();
        if (!pwOk(body.newPassword)) return json(400, { error: "كلمة المرور ٨ حروف على الأقل" });
        const t = (await adminQ("select id from profiles where username = $1", [username])).rows[0];
        if (!t) return json(404, { error: "المستخدم مش موجود" });
        await adminQ("update auth.users set password = $2 where id = $1", [t.id, body.newPassword]);
        return json(200, { success: true });
      }
      return json(404, { error: "unknown function" });
    }

    // ---------------- RPC ----------------
    const rpc = path.match(/^\/rest\/v1\/rpc\/([a-z_]+)$/);
    const sub = subOf(headers);
    try {
      if (rpc) {
        calls.rest.push({ method, rpc: rpc[1], body });
        const keys = Object.keys(body || {});
        const sql = `select ${ident(rpc[1])}(${keys.map((k, i) => `${ident(k)} => $${i + 1}`).join(", ")}) as result`;
        const r = await inTx(sub, (c) => c.query(sql, keys.map((k) => param(body[k]))));
        return json(200, r.rows[0].result);
      }
      const t = path.match(/^\/rest\/v1\/([a-z_]+)$/);
      if (!t || !TABLES.includes(t[1])) return json(404, { message: "not found" });
      const table = t[1];
      const wantsObject = (headers["accept"] || "").includes("vnd.pgrst.object");
      const prefer = headers["prefer"] || "";
      const wantsRep = prefer.includes("return=representation");
      calls.rest.push({ method, table, query: url.search, body });
      const respondRows = (rows, status = 200) => {
        if (wantsObject) {
          if (rows.length !== 1) return json(406, { code: "PGRST116", details: `The result contains ${rows.length} rows`, hint: null, message: "JSON object requested, multiple (or no) rows returned" });
          return json(status, rows[0]);
        }
        return json(status, rows);
      };
      const sel = url.searchParams.get("select");
      const cols = !sel || sel === "*" ? "*" : sel.split(",").map(ident).join(", ");

      if (method === "GET") {
        const { where, vals } = filtersOf(url.searchParams, 1);
        let sql = `select ${cols} from public.${ident(table)}`;
        if (where.length) sql += " where " + where.join(" and ");
        const order = url.searchParams.get("order");
        if (order) sql += " order by " + order.split(",").map((o) => { const [c, d] = o.split("."); return `${ident(c)} ${d === "desc" ? "desc" : "asc"}`; }).join(", ");
        const lim = Number(url.searchParams.get("limit"));
        if (lim > 0) sql += ` limit ${Math.floor(lim)}`;
        const r = await inTx(sub, (c) => c.query(sql, vals));
        return respondRows(r.rows);
      }
      if (method === "POST") {
        const items = Array.isArray(body) ? body : [body];
        const colNames = [...new Set(items.flatMap((i) => Object.keys(i)))];
        const vals = []; const tuples = items.map((it) => `(${colNames.map((cn) => { vals.push(cn in it ? param(it[cn]) : null); return `$${vals.length}`; }).join(", ")})`);
        let sql = `insert into public.${ident(table)} (${colNames.map(ident).join(", ")}) values ${tuples.join(", ")}`;
        if (prefer.includes("resolution=merge-duplicates")) {
          const target = (url.searchParams.get("on_conflict")?.split(",") || PK[table]).map(ident);
          sql += ` on conflict (${target.join(", ")}) do update set ${colNames.map((cn) => `${ident(cn)} = excluded.${ident(cn)}`).join(", ")}`;
        }
        // زي PostgREST: من غير return=representation مفيش RETURNING (وإلا policy القراءة هتتطبّق على الصف الجديد)
        if (wantsRep) sql += " returning *";
        const r = await inTx(sub, (c) => c.query(sql, vals));
        return wantsRep ? respondRows(r.rows, 201) : { status: 201, body: undefined };
      }
      if (method === "PATCH" || method === "DELETE") {
        let sql; let vals = [];
        if (method === "PATCH") {
          const setCols = Object.keys(body);
          vals = setCols.map((cn) => param(body[cn]));
          sql = `update public.${ident(table)} set ${setCols.map((cn, i) => `${ident(cn)} = $${i + 1}`).join(", ")}`;
        } else sql = `delete from public.${ident(table)}`;
        const { where, vals: fv } = filtersOf(url.searchParams, vals.length + 1);
        if (where.length) sql += " where " + where.join(" and ");
        sql += " returning *";   // (لازم نعرف عدد الصفوف؛ بتتجاهل في الرد لو مش representation)
        const r = await inTx(sub, (c) => c.query(sql, [...vals, ...fv]));
        return wantsRep ? respondRows(r.rows) : { status: 204, body: undefined };
      }
      return json(405, { message: "method not allowed" });
    } catch (e) {
      if (log) log(e.message);
      return pgError(e);
    }
  }
  return { handle, calls };
}
