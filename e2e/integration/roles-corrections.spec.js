// مدير الشيفت + حساب المطوّر المخفي + تصحيح يومية قديمة (والمدفوع والعهدة بيتحدّثوا لوحدهم) + مدفوع قبل السيستم
// + التقرير بيحسب عهدة الفيزا المكتوبة بالإيد + كروت تحصيل اليوم مفصّلة.
import { test, expect } from "../fixtures";
import { login, goTab, toast, cairoDate, shiftDay, myShiftKey, SHIFT_LABEL, digits } from "../ui";
import { readFileSync } from "node:fs";

async function users(env) {
  await env.seedUser("boss", "gm", "المدير");
  await env.seedUser("ahmed", "staff", "أحمد");
  await env.seedUser("sara", "staff", "سارة");
  await env.seedUser("mona", "shift_manager", "منى");
  await env.seedUser("devo", "dev", "المطوّر");
}
const rec = async (env, day, key) => (await env.q("select * from shift_records where date = $1 and shift_key = $2", [day, key]))[0];
const booking = async (env, id) => (await env.q("select amount_paid, payment_details, settled from bookings where id = $1", [id]))[0];
const body = (r) => (Array.isArray(r.body) ? r.body : []);
async function openHistory(page, day, key) {
  await goTab(page, "اليومية");
  const hist = page.getByRole("button", { name: /استعراض/ });
  await hist.click();
  await page.locator('input[type="date"]').fill(day);
  await page.getByRole("button", { name: SHIFT_LABEL[key], exact: true }).click();
}
const roomAmount = (page, num) => page.locator("table.cx-table tbody tr", { hasText: String(num) }).first().locator('input[type="number"]').first();

test("المطوّر: يصحّح يومية مقفولة من يومين - المدفوع على الحجز والعهدة اللي بعدها بيتحدّثوا، والتصحيح باين في السجل، والحساب مخفي", async ({ page, env }) => {
  await users(env);
  const d2 = cairoDate(-2), d1 = cairoDate(-1);
  const b = await env.seedBooking({ room: 601, guest: "Old Guest", start: -2, nights: 4, price: 500, paid: 800, currency: "EGP" });
  await env.seedShift("ahmed", { day: d2, key: "morning", closed: true, handover: { EGP: 100 }, closingCash: { EGP: 900 }, collections: [{ room: 601, amount: 800, currency: "EGP", bookingId: b }] });
  await env.seedShift("ahmed", { day: d1, key: "morning", closed: true, handover: { EGP: 900 }, closingCash: { EGP: 900 } });       // عهدته منقولة تلقائي
  await env.seedShift("sara", { day: d1, key: "evening", closed: true, handover: { EGP: 500 }, closingCash: { EGP: 500 } });         // عهدة مكتوبة بالإيد - ماتتلمسش

  await page.goto("/");
  await login(page, "devo");
  await openHistory(page, d2, "morning");
  await page.getByTestId("correction-start").click();
  await roomAmount(page, 601).fill("1000");
  await page.getByTestId("correction-save").click();
  await expect(toast(page)).toContainText("تم حفظ التصحيح");
  await expect(toast(page)).toContainText("1 شيفت");

  const fixed = await rec(env, d2, "morning");
  expect(Number(fixed.rows.find((r) => r.room === 601).collectionAmt)).toBe(1000);
  expect(fixed.closed).toBe(true);
  expect(fixed.closing_cash).toEqual({ EGP: 1100 });
  expect(fixed.total_collections).toEqual({ EGP: 1000 });
  expect(Number((await booking(env, b)).amount_paid)).toBe(1000);                       // المدفوع اتظبط بنفس الفرق
  const next = await rec(env, d1, "morning");
  expect(next.handover).toEqual({ EGP: 1100 });
  expect(next.closing_cash).toEqual({ EGP: 1100 });
  expect((await rec(env, d1, "evening")).handover).toEqual({ EGP: 500 });               // المكتوبة بالإيد زي ما هي

  const acts = await env.q("select user_name, username, role, action from activity_log where action like 'تصحيح يومية%' order by ts");
  expect(acts).toHaveLength(2);
  expect(acts[0]).toMatchObject({ user_name: "المطوّر", username: "devo", role: "dev" });
  expect((await env.q("select actor, action from money_audit where tbl = 'shift_records' and action = 'correct'")).every((a) => a.actor === "devo")).toBe(true);

  // الحساب مخفي ومحمي: المدير العام مايشوفوش، مايعدّلوش، وماحدش يتحوّل لمطوّر من الـ API
  expect(body(await env.api("boss", "GET", "/rest/v1/profiles?select=username")).map((p) => p.username)).not.toContain("devo");
  expect(body(await env.api("devo", "GET", "/rest/v1/profiles?select=username")).map((p) => p.username)).toContain("devo");
  await env.api("boss", "PATCH", "/rest/v1/profiles?username=eq.devo", { active: false });
  expect((await env.q("select active, role from profiles where username = 'devo'"))[0]).toEqual({ active: true, role: "dev" });
  const promote = await env.api("boss", "PATCH", "/rest/v1/profiles?username=eq.ahmed", { role: "dev" });
  expect(promote.status).toBeGreaterThanOrEqual(400);
  expect((await env.q("select role from profiles where username = 'ahmed'"))[0].role).toBe("staff");
  // والموظف العادي مايقدرش يصحّح
  const denied = await env.api("ahmed", "POST", "/rest/v1/rpc/correct_shift_record", { p_hotel: 1, p_date: d2, p_key: "morning", p_expected: null, p_record: { rows: [] } });
  expect(denied.status).toBeGreaterThanOrEqual(400);
  expect((await rec(env, d2, "morning")).rows).toHaveLength(16);
});

test("المطوّر مش ظاهر في قايمة الموظفين عند المدير العام، ولا اسمه بيتاخد", async ({ page, env }) => {
  await users(env);
  await page.goto("/");
  await login(page, "boss");
  await goTab(page, "إدارة المستخدمين");
  await expect(page.getByText("@ahmed")).toBeVisible();
  await expect(page.getByText("@devo")).toHaveCount(0);
  await expect(page.getByText("@mona")).toBeVisible();
  await expect(page.locator(".cx-role", { hasText: "مدير الشيفت" })).toBeVisible();
});

test("مدير الشيفت: تاباته، يصحّح يومية النهارده المقفولة، ومايقدرش على يوم قديم", async ({ page, env }) => {
  await users(env);
  const day = shiftDay(), key = myShiftKey(), old = cairoDate(-4);
  const b = await env.seedBooking({ room: 602, guest: "Today Guest", start: 0, nights: 2, price: 500, paid: 500, currency: "EGP", anchor: "shift" });
  await env.seedShift("ahmed", { day, key, closed: true, handover: { EGP: 0 }, closingCash: { EGP: 500 }, collections: [{ room: 602, amount: 500, currency: "EGP", bookingId: b }] });
  await env.seedShift("sara", { day: old, key: "morning", closed: true, handover: { EGP: 0 }, closingCash: { EGP: 0 } });

  await page.goto("/");
  await login(page, "mona");
  await expect(page.locator(".cx-tab")).toHaveCount(6);
  await openHistory(page, day, key);
  await page.getByTestId("correction-start").click();
  await roomAmount(page, 602).fill("300");
  await page.getByTestId("correction-save").click();
  await expect(toast(page)).toContainText("تم حفظ التصحيح");
  expect(Number((await rec(env, day, key)).rows.find((r) => r.room === 602).collectionAmt)).toBe(300);
  expect(Number((await booking(env, b)).amount_paid)).toBe(300);
  expect((await booking(env, b)).settled).toBe(false);

  await openHistory(page, old, "morning");
  await expect(page.locator("table.cx-table").first()).toBeVisible();
  await expect(page.getByTestId("correction-bar")).toHaveCount(0);
  const denied = await env.api("mona", "POST", "/rest/v1/rpc/correct_shift_record", { p_hotel: 1, p_date: old, p_key: "morning", p_expected: null, p_record: { handover: { EGP: 999 } } });
  expect(denied.status).toBeGreaterThanOrEqual(400);
  expect((await rec(env, old, "morning")).handover).toEqual({ EGP: 0 });
  // مدير الشيفت يلغي اختيار شيفت اتاخد بالغلط من الـ API (القاعدة بتسمح)، ومايقدرش يدير مستخدمين
  await env.api("mona", "PATCH", "/rest/v1/profiles?username=eq.ahmed", { active: false });
  expect((await env.q("select active from profiles where username = 'ahmed'"))[0].active).toBe(true);
});

test("مدفوع قبل السيستم: بيتحسب في المدفوع والمتبقي من غير ما يدخل أي يومية، وفحص التطابق بيعدّي", async ({ page, env }) => {
  await users(env);
  const b = await env.seedBooking({ room: 603, guest: "Paper Guest", start: -1, nights: 3, price: 400, paid: 0, currency: "EGP" });
  await page.goto("/");
  await login(page, "devo");
  await goTab(page, "الحجوزات");
  const card = page.locator("div", { has: page.getByTestId("prior-paid-open") }).filter({ hasText: "Paper Guest" }).last();
  await card.getByTestId("prior-paid-open").click();
  await page.getByTestId("prior-paid-amount").fill("700");
  await page.getByTestId("prior-paid-save").click();
  await expect(toast(page)).toContainText("مدفوع قبل السيستم");
  const row = await booking(env, b);
  expect(Number(row.amount_paid)).toBe(700);
  expect(Number(row.payment_details.priorPaid)).toBe(700);
  expect((await env.q("select count(*)::int n from shift_records"))[0].n).toBe(0);
  await expect(page.getByText("منها قبل السيستم").first()).toBeVisible();
  // تعديل الحجز من الـ API مايمسحش المبلغ ده
  await env.seedUser("rawan", "reservations", "روان");
  await env.api("rawan", "PATCH", `/rest/v1/bookings?id=eq.${b}`, { payment_details: { senderName: "", senderNumber: "", ref: "", onlinePaid: false }, notes: "x" });
  expect(Number((await booking(env, b)).payment_details.priorPaid)).toBe(700);
  // أكتر من المطلوب بيترفض
  const over = await env.api("devo", "POST", "/rest/v1/rpc/set_booking_prior_paid", { p_booking: b, p_amount: 5000, p_expected: null });
  expect(over.status).toBeGreaterThanOrEqual(400);
  // والمدير العام/مدير الحجوزات مايقدروش يسجّلوه (حساب المطوّر بس)
  expect((await env.api("boss", "POST", "/rest/v1/rpc/set_booking_prior_paid", { p_booking: b, p_amount: 100, p_expected: null })).status).toBeGreaterThanOrEqual(400);
  // فحص التطابق: مفيش "خطأ" بسبب المبلغ ده
  const res = await env.pool.query(readFileSync(new URL("../../supabase/ops/reconcile.sql", import.meta.url), "utf8"));
  const rows = (Array.isArray(res) ? res : [res]).flatMap((r) => r.rows || []);
  expect(rows.filter((r) => r.level === "خطأ")).toEqual([]);
});

test("التقرير بيحسب عهدة الفيزا المكتوبة بالإيد، وكروت تحصيل اليوم مفصّلة بالوسيلة وكل عملة في سطر", async ({ page, env }) => {
  await users(env);
  const day = shiftDay();
  await env.seedShift("ahmed", { day, key: "morning", closed: true, handover: { EGP: 0 }, closingCash: { EGP: 300 }, collections: [{ room: 601, amount: 1000, method: "فيزا", currency: "EGP" }, { room: 602, amount: 300, currency: "EGP" }, { room: 603, amount: 50, currency: "EUR" }] });
  await env.seedShift("sara", { day, key: "evening", closed: true, handover: { EGP: 300, EUR: 50 }, closingCash: { EGP: 300, EUR: 50 }, collections: [{ room: 604, amount: 200, method: "فيزا", currency: "EGP" }] });
  // موظفة المسائي كتبت عهدة فيزا 1500 بإيدها (غير الـ 1000 المتحصّلة قبلها)
  await env.qRaw(`update shift_records set method_handover = '{"فيزا":{"EGP":1500}}'::jsonb where shift_key = 'evening'`);
  await page.goto("/");
  await login(page, "boss");
  const rev = page.getByTestId("kpi-rev");
  await expect(rev).not.toContainText("…");
  const lines = (await rev.locator("bdi").allInnerTexts()).map((t) => t.trim());
  expect(lines).toContain("1,500 EGP");                         // الإجمالي بالجنيه في سطر
  expect(lines).toContain("50 EUR");                            // واليورو في سطر لوحده
  const split = digits(await page.getByTestId("kpi-rev-split").innerText());
  expect(split).toContain("كاش300EGP");
  expect(split).toContain("فيزا1200EGP");
  expect(await page.getByTestId("kpi-exp").innerText()).not.toContain("EUR");   // مفيش "0 EUR" في المصاريف
  if (process.env.OWNER_REPORT_OUT) await page.locator(".cx-kpi").first().locator("xpath=..").screenshot({ path: `${process.env.OWNER_REPORT_OUT}/kpi.png` });

  await goTab(page, "التقارير");
  const visa = page.getByTestId("balances-table").locator("tbody tr", { hasText: "فيزا" }).first();
  await expect(visa).toBeVisible();
  const cells = (await visa.locator("td").allInnerTexts()).map((t) => t.trim());
  expect(cells).toEqual(["فيزا", "EGP", "0", "1,200", "—", "+500", "1,700"]);
});
