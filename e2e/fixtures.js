import { test as base } from "@playwright/test";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { makeBridge, makeJwt } from "./pgBridge.js";
import { TEMPLATE, urlFor } from "./globalSetup.js";
import { cairoDate, shiftDay, myShiftKey } from "./ui.js";

const ADMIN = process.env.E2E_PG_ADMIN_URL;

/*
  fixture "env": قاعدة بيانات حقيقية جديدة لكل اختبار (نسخة من القالب) متوصّلة
  بالواجهة عن طريق الجسر (pgBridge). env.q(sql) للاستعلام كمشرف، env.seedUser
  لإنشاء مستخدم بدور معيّن، env.bridge.calls لمراجعة الطلبات اللي اتبعتت.
*/
export const test = base.extend({
  env: async ({ page, browser }, use) => {
    test.skip(!ADMIN, "اختبارات التكامل محتاجة E2E_PG_ADMIN_URL (انظر README)");
    const name = `calma_e2e_${process.pid}_${randomUUID().slice(0, 8).replace(/-/g, "")}`;
    const admin = new pg.Client({ connectionString: ADMIN });
    await admin.connect();
    await admin.query(`create database ${name} template ${TEMPLATE}`);
    await admin.end();
    const pool = new pg.Pool({ connectionString: urlFor(ADMIN, name), max: 4, options: "-c timezone=UTC" });
    pool.on("error", () => {});            // اتصال خامل اتقفل (مثلاً وقت مسح القاعدة في النهاية) - مش خطأ
    const bridge = makeBridge(pool);

    // الجسر بيتركّب على الـ context (مش الصفحة بس) عشان أي صفحة/جلسة تانية في نفس الاختبار تشتغل عليه
    const attach = async (ctx) => {
      await ctx.route("**/*.supabase.co/**", (r) => r.abort());
      await ctx.routeWebSocket(/fake-supabase\.test/, (ws) => { ws.close(); });
      await ctx.route("http://fake-supabase.test/**", async (route) => {
        const req = route.request();
        const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" };
        if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
        let body = null;
        try { body = req.postData() ? JSON.parse(req.postData()) : null; } catch { body = null; }
        let res;
        try { res = await bridge.handle({ method: req.method(), url: req.url(), headers: req.headers(), body }); }
        catch (e) { res = { status: 500, body: { message: String(e.message || e), code: "XX000" } }; }
        await route.fulfill({ status: res.status, headers: { ...cors, "content-type": "application/json", ...(res.headers || {}) }, body: res.body === undefined ? "" : JSON.stringify(res.body) });
      });
    };
    await attach(page.context());
    // جلسة متصفح تانية (localStorage منفصل) = مستخدم تاني على جهاز تاني
    const extraContexts = [];
    const newSession = async () => {
      const ctx = await browser.newContext({ baseURL: "http://localhost:4173", timezoneId: "Africa/Cairo", locale: "ar-EG" });
      extraContexts.push(ctx);
      await attach(ctx);
      return ctx.newPage();
    };
    // طلب مباشر على الـ API بهوية مستخدم (من غير الواجهة) - لاختبار إن قاعدة البيانات هي اللي بتفرض الصلاحيات
    const api = async (username, method, path, body, headers = {}) => {
      const sub = username && typeof username === "object" ? username.id : username ? (await pool.query("select id from profiles where username = $1", [username])).rows[0]?.id : null;
      const h = { ...(sub ? { authorization: `Bearer ${makeJwt(sub)}` } : {}), accept: "application/json", prefer: "return=representation", ...headers };
      return bridge.handle({ method, url: `http://fake-supabase.test${path}`, headers: h, body: body ?? null });
    };

    const q = (sql, params) => pool.query(sql, params).then((r) => r.rows);
    // تعديل مباشر من غير ما الـ triggers تشتغل (للتجهيز بس: مثلاً قرار رد سابق أو حالة مستحيلة تتعمل من الواجهة)
    const qRaw = async (sql, params) => {
      const c = await pool.connect();
      try { await c.query("begin"); await c.query("set local session_replication_role = replica"); const r = await c.query(sql, params); await c.query("commit"); return r.rows; }
      catch (e) { await c.query("rollback").catch(() => {}); throw e; } finally { c.release(); }
    };
    const seedUser = async (username, role, display = username, password = "Passw0rd1") => {
      const id = randomUUID();
      await pool.query("insert into auth.users(id, email, password) values ($1, $2, $3)", [id, `${username}@calma.internal`, password]);
      await pool.query("insert into profiles(id, username, name, role) values ($1, $2, $3, $4)", [id, username, display, role]);
      return id;
    };
    const emptyRow = (room) => ({ room, expenseDesc: "", expenseAmt: "", expenseCategory: "أخرى", expenseCurrency: "EGP", collectionDesc: "", collectionAmt: "", collectionMethod: "كاش", collectionCurrency: "EGP", paymentDetails: { senderName: "", senderNumber: "", ref: "", onlinePaid: false, commissionPct: 15 }, notes: "" });
    /* حجز جاهز مباشرة في القاعدة (بصلاحيات المشرف) - للتجهيز بس. التواريخ بالفرق من النهارده. */
    const seedBooking = async (o) => {
      const { room, guest, start = 0, nights = 1, price = 100, total = price * nights, paid = 0, settled = false, status = "مؤكد", method = "كاش", currency = "USD", source = "مباشر", extras, payment_details, by = "ahmed", role = "staff", leftEarly = false } = o;
      const [r] = await q(
        `insert into bookings(room, guest_name, checkin, checkout, price_night, total_room, amount_paid, settled, status, payment_method, currency, source, extras, payment_details, created_by, created_by_role, left_early)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, coalesce($13::jsonb, '{"laundry":0,"cafeteria":0,"tours":0,"pickup":0}'::jsonb), coalesce($14::jsonb, '{"senderName":"","senderNumber":"","ref":""}'::jsonb), $15, $16, $17) returning id`,
        [room, guest, cairoDate(start), cairoDate(start + nights), price, total, paid, settled, status, method, currency, source, extras ? JSON.stringify(extras) : null, payment_details ? JSON.stringify(payment_details) : null, by, role, leftEarly]);
      return r.id;
    };
    /* شيفت محجوز + يومية جاهزة لموظف (الشيفت الحالي بتوقيت القاهرة). collections: تحصيلات سابقة اتسجّلت في اليومية. */
    const seedShift = async (username = "ahmed", o = {}) => {
      const { key = myShiftKey(), day = shiftDay(), collections = [], closed = false, closingCash = null, methodClosing = null, rowsPatch = {}, cafePatch = {}, handover = { EGP: 0 }, flagged = false, notes = "", stored = {} } = o;
      const rooms = (await q("select number from rooms order by number")).map((r) => r.number);
      const rows = rooms.map(emptyRow);
      const bc = [];
      for (const c of collections) {
        const row = rows.find((x) => x.room === c.room);
        Object.assign(row, { collectionAmt: c.amount, collectionMethod: c.method || "كاش", collectionCurrency: c.currency || "USD", collectionDesc: c.desc || "تحصيل سابق", ...(c.bookingId ? { bookingId: c.bookingId } : {}) });
        if (c.bookingId) bc.push({ id: randomUUID(), bookingId: c.bookingId });
      }
      for (const [room, patch] of Object.entries(rowsPatch)) Object.assign(rows.find((x) => String(x.room) === String(room)), patch);
      const cafe = { ...emptyRow("كافيتيريا"), ...cafePatch };
      await q("insert into shift_claims(date, shift_key, username, name) select $1, $2, username, name from profiles where username = $3", [day, key, username]);
      await q(`insert into shift_records(date, shift_key, staff_name, staff_username, handover, rows, cafeteria, booking_collections, closed, closed_by, closing_cash, method_closing, flagged, shift_notes,
                                          total_expenses, total_collections, cash_collections, by_method_currency, by_category)
               select $1, $2, name, username, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb, $8, case when $8 then name end, $9::jsonb, $10::jsonb, $11, $12,
                      $13::jsonb, $14::jsonb, $15::jsonb, $16::jsonb, $17::jsonb from profiles where username = $3`,
        [day, key, username, JSON.stringify(handover), JSON.stringify(rows), JSON.stringify(cafe), JSON.stringify(bc), closed, closingCash && JSON.stringify(closingCash), methodClosing && JSON.stringify(methodClosing), flagged, notes,
         ...["total_expenses", "total_collections", "cash_collections", "by_method_currency", "by_category"].map((k) => (stored[k] ? JSON.stringify(stored[k]) : null))]);
      return { day, key };
    };
    await use({ pool, q, qRaw, seedUser, seedBooking, seedShift, bridge, name, api, newSession });
    // نوقف أي طلبات لسه جاية من الصفحات قبل ما نقفل الاتصال بالقاعدة ونمسحها
    await page.context().unrouteAll({ behavior: "ignoreErrors" }).catch(() => {});
    for (const c of extraContexts) { await c.unrouteAll({ behavior: "ignoreErrors" }).catch(() => {}); await c.close().catch(() => {}); }
    await pool.end().catch(() => {});
    const a2 = new pg.Client({ connectionString: ADMIN });
    await a2.connect();
    await a2.query(`drop database if exists ${name} with (force)`);
    await a2.end();
  },
});
export { expect } from "@playwright/test";
