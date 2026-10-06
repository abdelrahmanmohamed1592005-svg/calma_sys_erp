/*
  محاكي Supabase لاختبارات المتصفح: بيعترض كل طلبات الشبكة الخاصة بالمشروع
  الوهمي (http://fake-supabase.test) جوه المتصفح ويرد من بيانات في الذاكرة.
  بيغطي بس اللي التطبيق بيستخدمه: الدخول/التسجيل، جداول REST (فلاتر eq/gte/lte
  وترتيب وحد)، دالة profiles_exist، والـ Edge Functions. مفيش محاكاة لـ RLS -
  صلاحيات قاعدة البيانات الحقيقية متختبرة بشكل منفصل على Postgres.
*/
import { randomUUID } from "node:crypto";

const HOST = "fake-supabase.test";
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");

export function makeJwt(sub) {
  return `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub, role: "authenticated", aud: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
}

const ROOMS = [601, 602, 603].map((number) => ({ number, name: `غرفة-${number}` }));

export function makeUser(username, password, role, name = username) {
  return { password, profile: { id: randomUUID(), username, name, role, active: true, created_at: new Date().toISOString() } };
}

/* opts.users: [{username,password,role,name}]  - opts.profilesExist: يتحسب من المستخدمين لو متحددش */
export async function installFakeSupabase(page, opts = {}) {
  const users = (opts.users || []).map((u) => makeUser(u.username, u.password, u.role, u.name));
  const store = {
    users,
    profiles: users.map((u) => u.profile),
    rooms: ROOMS.map((r) => ({ ...r })),
    room_overrides: [], bookings: [], shift_records: [], shift_claims: [], activity_log: [],
    requests: [], // كل طلبات REST (للتأكد من اللي اتبعت فعلاً)
    functionCalls: [],
  };

  const userByToken = (req) => {
    const m = (req.headers()["authorization"] || "").match(/^Bearer (.+)$/);
    if (!m) return null;
    try { const sub = JSON.parse(Buffer.from(m[1].split(".")[1], "base64url").toString()).sub; return store.users.find((u) => u.profile.id === sub) || null; } catch { return null; }
  };
  const sessionFor = (u) => ({
    access_token: makeJwt(u.profile.id), token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: "r-" + u.profile.id,
    user: { id: u.profile.id, aud: "authenticated", role: "authenticated", email: `${u.profile.username}@calma.internal`, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() },
  });
  const json = (route, status, body, headers = {}) => route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*", ...headers }, body: body === undefined ? "" : JSON.stringify(body) });

  function applyFilters(rows, params) {
    let out = rows.slice();
    for (const [k, v] of params.entries()) {
      if (["select", "order", "limit", "offset", "on_conflict", "columns"].includes(k)) continue;
      const m = v.match(/^(eq|gte|lte)\.(.*)$/);
      if (!m) continue;
      const [, op, val] = m;
      out = out.filter((r) => {
        const cell = String(r[k] ?? "");
        return op === "eq" ? cell === val : op === "gte" ? cell >= val : cell <= val;
      });
    }
    const order = params.get("order");
    if (order) {
      const [col, dir] = order.split(".");
      out.sort((a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0) * (dir === "desc" ? -1 : 1));
    }
    const lim = Number(params.get("limit"));
    if (lim) out = out.slice(0, lim);
    return out;
  }

  const KEY = { rooms: "number", room_overrides: "room_number" };
  function fillDefaults(table, row, actor) {
    const now = new Date().toISOString();
    const r = { ...row };
    if (table === "bookings") Object.assign(r, { id: randomUUID(), created_at: now, updated_at: now, created_by: actor?.profile.username, created_by_role: actor?.profile.role, refund_pending: false });
    if (table === "shift_records") Object.assign(r, { updated_at: now, staff_username: actor?.profile.username, staff_name: actor?.profile.name });
    if (table === "shift_claims") Object.assign(r, { claimed_at: now, username: actor?.profile.username, name: actor?.profile.name });
    if (table === "activity_log") Object.assign(r, { id: randomUUID(), ts: now, username: actor?.profile.username, user_name: actor?.profile.name, role: actor?.profile.role });
    if (table === "room_overrides") Object.assign(r, { updated_at: now, updated_by: actor?.profile.username });
    return r;
  }

  await page.route("**/*.supabase.co/**", (route) => route.abort()); // حماية: مفيش اتصال بمشروع حقيقي أبدًا
  await page.routeWebSocket(/fake-supabase\.test/, (ws) => { ws.close(); }); // Realtime مش متحاكي - التطبيق عنده فحص احتياطي كل دقيقة

  await page.route(`http://${HOST}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    const method = req.method();
    if (method === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
    const body = req.postData() ? JSON.parse(req.postData()) : null;

    // ---------- Auth ----------
    if (path === "/auth/v1/token") {
      const u = store.users.find((x) => `${x.profile.username}@calma.internal` === String(body?.email || "").toLowerCase());
      if (!u || u.password !== body.password) return json(route, 400, { code: 400, error_code: "invalid_credentials", msg: "Invalid login credentials" });
      return json(route, 200, sessionFor(u));
    }
    if (path === "/auth/v1/signup") {
      const username = String(body.email).split("@")[0];
      if (store.users.some((x) => x.profile.username === username)) return json(route, 422, { code: 422, error_code: "user_already_exists", msg: "User already registered" });
      const u = makeUser(username, body.password, "pending");
      u.pendingSignup = true;
      store.users.push(u);
      return json(route, 200, sessionFor(u));
    }
    if (path === "/auth/v1/logout") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*" } });
    if (path === "/auth/v1/user" && method === "PUT") return json(route, 200, { id: userByToken(req)?.profile.id });
    if (path === "/auth/v1/user") { const u = userByToken(req); return u ? json(route, 200, sessionFor(u).user) : json(route, 401, { msg: "invalid" }); }

    // ---------- Edge Functions ----------
    const fn = path.match(/^\/functions\/v1\/(.+)$/);
    if (fn) {
      store.functionCalls.push({ name: fn[1], body });
      if (fn[1] === "create-user") {
        const caller = userByToken(req);
        if (!caller || caller.profile.role !== "gm") return json(route, 403, { error: "الصلاحية دي للمدير العام بس" });
        if (store.users.some((x) => x.profile.username === body.username)) return json(route, 409, { error: "اسم المستخدم ده موجود بالفعل" });
        const nu = makeUser(body.username, body.password, body.role, body.name);
        store.users.push(nu); store.profiles.push(nu.profile);
        return json(route, 200, { success: true, data: { id: nu.profile.id, username: nu.profile.username, name: nu.profile.name, role: nu.profile.role, active: true } });
      }
      if (fn[1] === "reset-password") {
        const target = store.users.find((x) => x.profile.username === body.username);
        if (!target) return json(route, 404, { error: "المستخدم مش موجود" });
        target.password = body.newPassword;
        return json(route, 200, { success: true });
      }
      return json(route, 404, { error: "unknown function" });
    }

    // ---------- RPC ----------
    const rpc = path.match(/^\/rest\/v1\/rpc\/(.+)$/);
    if (rpc) {
      if (rpc[1] === "profiles_exist") return json(route, 200, store.profiles.length > 0);
      return json(route, 404, { message: "unknown rpc" });
    }

    // ---------- REST tables ----------
    const t = path.match(/^\/rest\/v1\/([a-z_]+)$/);
    if (!t || !(t[1] in store)) return json(route, 404, { message: "not found" });
    const table = t[1];
    const actor = userByToken(req);
    const wantsObject = (req.headers()["accept"] || "").includes("vnd.pgrst.object");
    const wantsRep = (req.headers()["prefer"] || "").includes("return=representation");
    store.requests.push({ method, table, query: url.search, body });
    const respondRows = (rows, status = 200) => {
      if (wantsObject) {
        if (rows.length !== 1) return json(route, 406, { code: "PGRST116", details: `The result contains ${rows.length} rows`, hint: null, message: "JSON object requested, multiple (or no) rows returned" });
        return json(route, status, rows[0]);
      }
      return json(route, status, rows);
    };

    if (method === "GET") return respondRows(applyFilters(store[table], url.searchParams));
    if (method === "POST") {
      const items = Array.isArray(body) ? body : [body];
      const created = [];
      for (const item of items) {
        const key = KEY[table];
        const merge = (req.headers()["prefer"] || "").includes("resolution=merge-duplicates");
        const row = fillDefaults(table, item, actor);
        if (key && merge) {
          const i = store[table].findIndex((r) => r[key] === item[key]);
          if (i >= 0) { store[table][i] = { ...store[table][i], ...row }; created.push(store[table][i]); continue; }
        }
        if (table === "shift_claims" && store[table].some((r) => r.date === row.date && r.shift_key === row.shift_key)) return json(route, 409, { code: "23505", message: "duplicate key value" });
        if (table === "profiles") {
          const owner = store.users.find((x) => x.profile.id === row.id);
          if (owner) { Object.assign(owner.profile, row); delete owner.pendingSignup; }
          created.push(row); store.profiles.push(owner ? owner.profile : row);
          continue;
        }
        store[table].push(row); created.push(row);
      }
      return wantsRep ? respondRows(created, 201) : route.fulfill({ status: 201, headers: { "access-control-allow-origin": "*" } });
    }
    if (method === "PATCH") {
      const rows = applyFilters(store[table], url.searchParams);
      rows.forEach((r) => Object.assign(r, body, table === "bookings" || table === "shift_records" ? { updated_at: new Date(Date.now() + 1).toISOString() } : {}));
      return wantsRep ? respondRows(rows) : route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*" } });
    }
    if (method === "DELETE") {
      const rows = applyFilters(store[table], url.searchParams);
      store[table] = store[table].filter((r) => !rows.includes(r));
      return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*" } });
    }
    return json(route, 405, { message: "method not allowed" });
  });

  return store;
}
