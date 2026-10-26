/*
  أدلة تشغيل حقيقية: كل سيناريو حرج بيتفحص على 3 طبقات - الواجهة (نص + لقطة شاشة)، طلب/رد الـ API
  الفعلي اللي طلع من المتصفح، والسجلات المحفوظة فعلًا في Postgres حقيقي (قاعدة معزولة لكل اختبار).
  الناتج: evidence-out/<سيناريو>.json + .png ثم `node scripts/evidence-report.mjs` يطلّع EVIDENCE.md.
  بيانات الاختبار وهمية بالكامل؛ الباسوردات وتوكنات الدخول بتتشال من الطلبات المسجّلة.
*/
import fs from "node:fs";
import { test, expect } from "../fixtures";
import { digits, login, logout, goTab, toast, openRoom, payOnBoard, waitIdle, field, openMore } from "../ui";

const OUT = "evidence-out";
const redact = (o) => JSON.parse(JSON.stringify(o ?? null, (k, v) => (/pass(word)?|token|apikey|authorization/i.test(k) ? "[REDACTED]" : v)));

function recorder(page, env, name) {
  const api = []; const steps = [];
  fs.mkdirSync(OUT, { recursive: true });
  page.on("response", async (res) => {
    const u = res.url();
    if (!u.includes("fake-supabase.test/rest/v1/") || res.request().method() === "OPTIONS") return;
    const m = res.request().method();
    if (m === "GET" && !u.includes("/rpc/")) return;           // قراءات التحميل العادية مش محتاجة تتسجّل
    let body = null; try { body = await res.json(); } catch { /* فاضي */ }
    let req = null; try { req = res.request().postDataJSON(); } catch { /* فاضي */ }
    api.push({ method: m, path: u.split("/rest/v1/")[1].split("?")[0], request: redact(req), status: res.status(), response: redact(body) });
  });
  return {
    api,
    async step(label, { db, expectUi } = {}) {
      const file = `${name}-${steps.length + 1}.png`;
      await page.screenshot({ path: `${OUT}/${file}` });
      steps.push({ label, ui: { toast: (await toast(page).allInnerTexts().catch(() => [])).slice(-1)[0] || null, expect: expectUi || null }, apiCount: api.length, db: db ? await env.q(db) : null, screenshot: file });
    },
    save(extra = {}) { fs.writeFileSync(`${OUT}/${name}.json`, JSON.stringify({ name, steps, api, ...extra }, null, 1)); },
  };
}
async function base(env) {
  await env.seedUser("boss", "gm", "المدير");
  await env.seedUser("ahmed", "staff", "أحمد");
  await env.seedUser("rawan", "reservations", "روان");
}

test("EV1 تحصيل صحيح: واجهة + RPC + حجز + يومية + تقرير", async ({ page, env }) => {
  await base(env);
  const id = await env.seedBooking({ room: 601, guest: "Evidence Guest", nights: 2, price: 100 });
  await env.seedShift("ahmed");
  const r = recorder(page, env, "EV1-valid-payment");
  await page.goto("/"); await login(page, "ahmed");
  await goTab(page, "لوحة الغرف"); await openRoom(page, 601);
  await payOnBoard(page, { amount: 120, method: "فيزا", last4: "4242" });
  await expect(toast(page)).toContainText("تم");
  await r.step("بعد تسجيل 120 فيزا", { db: "select amount_paid, settled, payment_method from bookings" });
  const rpc = r.api.filter((a) => a.path === "rpc/record_booking_payment");
  expect(rpc).toHaveLength(1); expect(rpc[0].status).toBe(200);
  const [b] = await env.q("select amount_paid, settled from bookings where id=$1", [id]);
  expect(b).toEqual({ amount_paid: 120, settled: false });
  const [rec] = await env.q("select rows, booking_collections from shift_records");
  const mine = rec.rows.filter((x) => x.bookingId === id);
  expect(mine.reduce((a, x) => a + Number(x.collectionAmt), 0)).toBe(120);
  expect(mine[0].collectionMethod).toBe("فيزا"); expect(JSON.stringify(mine[0].paymentDetails)).toContain("4242");
  await logout(page); await login(page, "rawan");
  await goTab(page, "التقارير");
  await page.waitForTimeout(1200);
  await r.step("التقرير", { expectUi: "إجمالي التحصيل = 120" });
  const txt = digits(await page.locator(".cx-report-grid").first().innerText());
  expect(txt).toContain("120$");
  r.save();
});

test("EV2 مدخلات غلط: صفر/سالب/أكبر من المتبقي/فيزا بلا 4 أرقام - مفيش تغيير في القاعدة", async ({ page, env }) => {
  await base(env);
  const id = await env.seedBooking({ room: 601, guest: "Invalid Guest", nights: 1, price: 100 });
  await env.seedShift("ahmed");
  const r = recorder(page, env, "EV2-invalid-input");
  await page.goto("/"); await login(page, "ahmed");
  await goTab(page, "لوحة الغرف"); await openRoom(page, 601);
  for (const [amount, method] of [["0", "كاش"], ["-5", "كاش"], ["500", "كاش"], ["50", "فيزا"]]) {
    await payOnBoard(page, { amount, method });
    await r.step(`مبلغ ${amount} بوسيلة ${method}`, { db: "select amount_paid from bookings" });
  }
  expect(await env.q("select amount_paid from bookings where id=$1", [id])).toEqual([{ amount_paid: 0 }]);
  // نفس الحاجة على مستوى الـ API مباشرة (القاعدة هي اللي بتحمي)
  for (const amt of [0, -5, 500, "abc"]) {
    const res = await env.api("ahmed", "POST", "/rest/v1/rpc/record_booking_payment", { p_booking: id, p_amount: amt, p_method: "كاش", p_details: {}, p_expected: null, p_note: null });
    r.api.push({ method: "POST", path: "rpc/record_booking_payment (direct)", request: { p_amount: amt }, status: res.status, response: res.body });
    expect(res.status).toBeGreaterThanOrEqual(400);
  }
  expect((await env.q("select amount_paid from bookings"))[0].amount_paid).toBe(0);
  expect(await env.q("select 1 from shift_records where jsonb_array_length(booking_collections) > 0")).toHaveLength(0);
  r.save();
});

test("EV3 ضغط مزدوج: دفعة واحدة بس", async ({ page, env }) => {
  await base(env);
  const id = await env.seedBooking({ room: 601, guest: "Double Click", nights: 1, price: 100 });
  await env.seedShift("ahmed");
  const r = recorder(page, env, "EV3-duplicate-submit");
  await page.goto("/"); await login(page, "ahmed");
  await goTab(page, "لوحة الغرف"); await openRoom(page, 601);
  const btn = page.getByTestId("pay-panel").getByTestId("pay-record");
  await btn.dblclick(); await btn.click({ force: true, timeout: 1500 }).catch(() => {});
  await waitIdle(page); await page.waitForTimeout(500);
  await r.step("بعد 3 ضغطات", { db: "select amount_paid from bookings" });
  expect((await env.q("select amount_paid from bookings where id=$1", [id]))[0].amount_paid).toBe(100);
  const ok = r.api.filter((a) => a.path === "rpc/record_booking_payment" && a.status === 200);
  expect(ok.length).toBe(1);
  r.save({ rpcCalls: r.api.filter((a) => a.path === "rpc/record_booking_payment").length });
});

test("EV4 صلاحيات: مدير حجوزات ومحاسب وموظف بلا شيفت مايقدروش يلمسوا الفلوس مباشرة", async ({ page, env }) => {
  await base(env); await env.seedUser("acc", "accounts", "محاسب");
  const id = await env.seedBooking({ room: 601, guest: "Perm Guest", nights: 1, price: 100 });
  await env.seedShift("ahmed");
  const r = recorder(page, env, "EV4-unauthorized");
  await page.goto("/"); await login(page, "ahmed"); await r.step("الموظف داخل");
  const pay = { p_booking: id, p_amount: 50, p_method: "كاش", p_details: {}, p_expected: null, p_note: null };
  const cases = [];
  for (const who of ["rawan", "acc"]) {
    const res = await env.api(who, "POST", "/rest/v1/rpc/record_booking_payment", pay);
    cases.push({ who, action: "rpc record_booking_payment", status: res.status, body: res.body }); expect(res.status).toBeGreaterThanOrEqual(400);
  }
  for (const who of ["ahmed", "rawan"]) {
    const res = await env.api(who, "PATCH", `/rest/v1/bookings?id=eq.${id}`, { amount_paid: 999 });
    cases.push({ who, action: "PATCH bookings.amount_paid=999", status: res.status, body: res.body });
  }
  const anon = await env.api(null, "POST", "/rest/v1/rpc/record_booking_payment", pay);
  cases.push({ who: "anon", action: "rpc بدون توكن", status: anon.status, body: anon.body }); expect(anon.status).toBeGreaterThanOrEqual(400);
  expect((await env.q("select amount_paid from bookings where id=$1", [id]))[0].amount_paid).toBe(0);
  r.save({ cases });
});

test("EV5 تعافي من فشل: السيرفر 500 ثم إعادة المحاولة تنجح مرة واحدة", async ({ page, env }) => {
  await base(env);
  const id = await env.seedBooking({ room: 601, guest: "Retry Guest", nights: 1, price: 100 });
  await env.seedShift("ahmed");
  const r = recorder(page, env, "EV5-failure-recovery");
  await page.goto("/"); await login(page, "ahmed");
  await goTab(page, "لوحة الغرف"); await openRoom(page, 601);
  let fail = true;
  await page.route(/fake-supabase\.test\/rest\/v1\/rpc\/record_booking_payment/, (route) => fail
    ? route.fulfill({ status: 500, headers: { "access-control-allow-origin": "*", "content-type": "application/json" }, body: JSON.stringify({ message: "boom", code: "XX000" }) })
    : route.fallback());
  await payOnBoard(page);
  await r.step("بعد الفشل", { db: "select amount_paid from bookings" });
  expect((await env.q("select amount_paid from bookings where id=$1", [id]))[0].amount_paid).toBe(0);
  fail = false;
  await payOnBoard(page);
  await expect(toast(page)).toContainText("الحجز مدفوع بالكامل");
  await r.step("بعد إعادة المحاولة", { db: "select amount_paid, settled from bookings" });
  expect(await env.q("select amount_paid, settled from bookings where id=$1", [id])).toEqual([{ amount_paid: 100, settled: true }]);
  r.save();
});

test("EV6 إلغاء مدفوع: مفيش رد فلوس - الحجز واليومية والتقرير بيفضلوا بنفس الرقم، ودالة الرد مقفولة", async ({ page, env }) => {
  await base(env);
  const id = await env.seedBooking({ room: 601, guest: "Kept Guest", nights: 2, price: 100 });
  await env.seedShift("ahmed");
  const r = recorder(page, env, "EV6-cancel-kept");
  // الموظف يحصّل 200 (100 كاش + 100 فيزا) ثم الحجز يتلغي
  await page.goto("/"); await login(page, "ahmed");
  await goTab(page, "لوحة الغرف"); await openRoom(page, 601);
  await payOnBoard(page, { amount: 100, method: "كاش" });
  await payOnBoard(page, { amount: 100, method: "فيزا", last4: "1111" });
  const cr = await env.api("rawan", "PATCH", `/rest/v1/bookings?id=eq.${id}`, { status: "ملغي" });
  r.api.push({ method: "PATCH", path: "bookings (cancel by reservations)", request: { status: "ملغي" }, status: cr.status, response: redact(cr.body) });
  const cancelled = await env.q("select status, refund_pending, amount_paid from bookings where id=$1", [id]);
  r.api.push({ method: "NOTE", path: "state after cancel (DB trigger)", request: null, status: 0, response: cancelled });
  expect(cancelled[0]).toEqual({ status: "ملغي", refund_pending: false, amount_paid: 200 });
  await page.evaluate(() => localStorage.clear()); await page.goto("/"); await login(page, "rawan");
  await goTab(page, "الحجوزات"); await page.getByTestId("status-filter-all").click();
  const card = page.locator(".cx-card", { hasText: "Kept Guest" }).last();
  await expect(card.getByTestId("refund-status")).toContainText("فضلت في الفندق");
  await expect(card.getByTestId("refund-request")).toHaveCount(0);
  await r.step("الحجز الملغي - الفلوس فضلت في الفندق");
  const [rec] = await env.q("select rows from shift_records");
  const net = {}; for (const x of rec.rows.filter((x) => x.bookingId === id)) net[x.collectionMethod] = (net[x.collectionMethod] || 0) + Number(x.collectionAmt || 0);
  expect(net).toEqual({ "كاش": 100, "فيزا": 100 });
  // دالة رد الفلوس القديمة مقفولة على الكل
  const again = await env.api("rawan", "POST", "/rest/v1/rpc/decide_booking_refund", { p_booking: id, p_decision: "refund", p_expected: null, p_method: "كاش" });
  r.api.push({ method: "POST", path: "rpc/decide_booking_refund (closed)", request: { p_decision: "refund" }, status: again.status, response: again.body });
  expect(again.status).toBeGreaterThanOrEqual(400);
  expect((await env.q("select amount_paid from bookings where id=$1", [id]))[0].amount_paid).toBe(200);
  r.save({ netByMethod: net });
});
