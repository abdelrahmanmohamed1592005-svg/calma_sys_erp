// مدير الشيفت + حساب المطوّر المخفي + تصحيح يومية قديمة (والمدفوع والعهدة بيتحدّثوا لوحدهم) + مدفوع قبل السيستم
// + التقرير بيحسب عهدة الفيزا المكتوبة بالإيد + كروت تحصيل اليوم مفصّلة.
import { test, expect } from "../fixtures";
import { login, logout, goTab, toast, addBooking, claimShift, openRoom, cairoDate, shiftDay, myShiftKey, SHIFT_LABEL, digits, openPaySections } from "../ui";
import { readFileSync } from "node:fs";
const addDaysStr = (d, n) => { const t = new Date(d + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };

// الإجراءات الثانوية في كارت الحجز (مدفوع قبل السيستم وأدوات المطوّر) تحت "⋯ المزيد"
async function openMoreMenus(page) {
  await page.getByTestId("booking-more").first().waitFor();
  for (const s of await page.getByTestId("booking-more").locator("summary").all()) await s.click();
}

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

test("مدير الشيفت: الليلي اللي قبل يومه بيتصحّح، والمسائي اللي قبله لأ - وتغيير عملة حجز ليه تحصيل في شيفت مقفول منه هو أو المطوّر بس", async ({ env }) => {
  await users(env);
  const prev = addDaysStr(shiftDay(), -1);
  await env.seedShift("ahmed", { day: prev, key: "night", closed: true, handover: { EGP: 0 }, closingCash: { EGP: 0 } });
  await env.seedShift("sara", { day: prev, key: "evening", closed: true, handover: { EGP: 0 }, closingCash: { EGP: 0 } });
  const ok = await env.api("mona", "POST", "/rest/v1/rpc/correct_shift_record", { p_hotel: 1, p_date: prev, p_key: "night", p_expected: null, p_record: { shift_notes: "مراجعة" } });
  expect(ok.status).toBeLessThan(300);
  expect((await rec(env, prev, "night")).shift_notes).toBe("مراجعة");
  const denied = await env.api("mona", "POST", "/rest/v1/rpc/correct_shift_record", { p_hotel: 1, p_date: prev, p_key: "evening", p_expected: null, p_record: { shift_notes: "x" } });
  expect(denied.status).toBeGreaterThanOrEqual(400);

  // تحصيل في شيفت مقفول: مدير الحجوزات مرفوض، والموظف مرفوض
  await env.seedUser("resv", "reservations", "الحجوزات");
  const b = await env.seedBooking({ room: 605, guest: "Closed Cur", start: -1, nights: 3, price: 100, paid: 100, currency: "EGP" });
  await env.seedShift("ahmed", { day: cairoDate(-3), key: "morning", closed: true, handover: { EGP: 0 }, closingCash: { EGP: 100 }, collections: [{ room: 605, amount: 100, currency: "EGP", bookingId: b }] });
  const r1 = await env.api("resv", "POST", "/rest/v1/rpc/change_booking_currency", { p_booking: b, p_currency: "USD", p_expected: null });
  expect(r1.status).toBeGreaterThanOrEqual(400);
  expect(JSON.stringify(r1.body)).toContain("مدير الشيفت أو المطوّر");
  expect((await env.q("select currency from bookings where id = $1", [b]))[0].currency).toBe("EGP");
  const r2 = await env.api("devo", "POST", "/rest/v1/rpc/change_booking_currency", { p_booking: b, p_currency: "USD", p_expected: null });
  expect(r2.status).toBeLessThan(300);
  expect((await env.q("select currency from bookings where id = $1", [b]))[0].currency).toBe("USD");
});

test("قفل تلقائي: شيفت فضل مفتوح أكتر من ٢٤ ساعة بعد معاده بيتقفل لوحده وأرقامه بتتحسب، والتنبيه الأحمر اتشال", async ({ page, env }) => {
  await users(env);
  await env.seedShift("sara", { day: cairoDate(-3), key: "evening", closed: false, handover: { EGP: 50 }, collections: [{ room: 601, amount: 200, currency: "EGP" }] });
  await page.goto("/");
  await login(page, "mona");
  await goTab(page, "اليومية");
  await expect.poll(async () => (await rec(env, cairoDate(-3), "evening")).closed).toBe(true);
  const r = await rec(env, cairoDate(-3), "evening");
  expect(r.closed_by).toBe("إقفال تلقائي");
  expect(Number(r.closing_cash.EGP)).toBe(250);
  await expect(page.getByTestId("stale-open-shift")).toHaveCount(0);
});

test("سعر العملة بالمصري على الحجز: حجز بالدولار والجيست بيدفع بالجنيه - بيتحوّل بسعر الحجز، والزيادة مسموحة", async ({ page, env }) => {
  await users(env);
  const b = await env.seedBooking({ room: 606, guest: "FX Guest", start: 0, nights: 2, price: 50, paid: 0, currency: "USD", anchor: "shift" });
  await env.q("update bookings set fx_rates = '{\"USD\": 50}'::jsonb where id = $1", [b]);
  await page.goto("/");
  await login(page, "ahmed");
  await claimShift(page);
  await goTab(page, "لوحة الغرف");
  await openRoom(page, 606);
  await expect(page.getByTestId("money-box")).toContainText("سعر الـ USD بالمصري");
  const panel = page.getByTestId("pay-panel");
  await panel.getByTestId("pay-currency").selectOption("EGP");
  await panel.getByTestId("pay-amount").fill("2500");              // = 50 دولار
  await panel.getByTestId("pay-record").click();
  await expect(toast(page)).toBeVisible();
  expect(digits(await toast(page).innerText())).toContain("تمتسجيل2500EGP");
  expect(digits(await toast(page).innerText())).toContain("المتبقي50USD");
  expect(Number((await booking(env, b)).amount_paid)).toBe(50);
  const row = (await env.q("select r from shift_records, jsonb_array_elements(rows) r where r ->> 'bookingId' = $1", [b]))[0].r;
  expect(row).toMatchObject({ collectionAmt: 2500, collectionCurrency: "EGP", fxCovered: 50 });   // الخزينة بالجنيه الفعلي
  // الباقي 50 دولار: يدفع 3000 جنيه (= 60 دولار) - زيادة 10 دولار عادي
  await panel.getByTestId("pay-currency").selectOption("EGP");
  await panel.getByTestId("pay-amount").fill("3000");
  await panel.getByTestId("pay-record").click();
  await expect.poll(async () => digits(await toast(page).innerText())).toContain("تمتسجيل3000EGP");
  expect(Number((await booking(env, b)).amount_paid)).toBe(110);
});

test("تعديل المدفوع بسعر الحجز: حجز 33 دولار والدولار بـ 54 - دفع 31 دولار والباقي 108 جنيه = اتدفع بالكامل", async ({ page, env }) => {
  await users(env);
  const day = shiftDay(), key = myShiftKey();
  const b = await env.seedBooking({ room: 608, guest: "Split FX", start: 0, nights: 1, price: 33, paid: 31, currency: "USD", anchor: "shift" });
  await env.q("update bookings set fx_rates = '{\"USD\": 54}'::jsonb where id = $1", [b]);
  await env.seedShift("mona", { day, key, closed: false, handover: {}, collections: [{ room: 608, amount: 31, currency: "USD", bookingId: b }] });
  await page.goto("/");
  await login(page, "mona");
  await goTab(page, "الحجوزات");
  await page.getByTestId("edit-price").first().click();
  await openPaySections(page);
  await page.getByTestId("form-edit-payments").getByTestId("edit-payments-open").click();
  await page.getByTestId("edit-pay-0-add").click();
  await page.getByTestId("edit-pay-0-amount-1").fill("108");
  await page.getByTestId("edit-pay-0-currency-1").selectOption("EGP");
  await page.getByTestId("edit-payment-save").click();
  await expect(toast(page)).toContainText("اتعدّلت الدفعة");
  expect(Number((await booking(env, b)).amount_paid)).toBe(33);
  expect((await booking(env, b)).settled).toBe(true);
  const egp = (await rec(env, day, key)).rows.find((x) => x.bookingId === b && x.collectionCurrency === "EGP");
  expect(egp).toMatchObject({ collectionAmt: 108, fxCovered: 2, fxBookingCurrency: "USD" });   // الخزينة 108 جنيه فعلي
});

test("سعر العملة من جنب الدفعة: حجز دولار مالوش سعر - في تعديل المدفوع وكارت الغرفة بنختار جنيه وبنكتب سعر الدولار مرة واحدة", async ({ page, env }) => {
  await users(env);
  const day = shiftDay(), key = myShiftKey();
  const b = await env.seedBooking({ room: 609, guest: "No Rate", start: 0, nights: 2, price: 33, paid: 31, currency: "USD", anchor: "shift" });
  await env.seedShift("mona", { day, key, closed: false, handover: {}, collections: [{ room: 609, amount: 31, currency: "USD", bookingId: b }] });
  await page.goto("/");
  await login(page, "mona");
  await goTab(page, "الحجوزات");
  await page.getByTestId("edit-price").first().click();
  await openPaySections(page);
  await page.getByTestId("form-edit-payments").getByTestId("edit-payments-open").click();
  await page.getByTestId("edit-pay-0-add").click();
  await page.getByTestId("edit-pay-0-amount-1").fill("108");
  await page.getByTestId("edit-pay-0-currency-1").selectOption("EGP");
  await page.getByTestId("edit-pay-0-1-rate-USD").fill("54");          // خانة السعر بتظهر لوحدها
  await page.getByTestId("edit-payment-save").click();
  await expect(toast(page)).toContainText("اتعدّلت الدفعة");
  expect(Number((await booking(env, b)).amount_paid)).toBe(33);
  expect((await env.q("select fx_rates from bookings where id = $1", [b]))[0].fx_rates).toEqual({ USD: 54 });
  // كارت الغرفة: الباقي (33 دولار) بالجنيه - السعر متحدد خلاص فمفيش خانة سعر
  await page.keyboard.press("Escape");
  await goTab(page, "لوحة الغرف");
  await openRoom(page, 609);
  const panel = page.getByTestId("pay-panel");
  await panel.getByTestId("pay-currency").selectOption("EGP");
  await expect(panel.getByTestId("pay-rate-USD")).toHaveCount(0);
  await panel.getByTestId("pay-amount").fill("1782");                  // = 33 دولار
  await panel.getByTestId("pay-record").click();
  await expect(toast(page)).toContainText("تم تسجيل");
  expect(Number((await booking(env, b)).amount_paid)).toBe(66);
});

test("تعديل الدفعة لصفر: الصف بيتشال من اليومية خالص، والكارت بيبان إن عليه فلوس تاني، والدفعة الجديدة صف جديد", async ({ page, env }) => {
  await users(env);
  const day = shiftDay(), key = myShiftKey();
  const b = await env.seedBooking({ room: 610, guest: "Zero Edit", start: 0, nights: 1, price: 300, paid: 300, currency: "EGP", anchor: "shift" });
  await env.seedShift("mona", { day, key, closed: false, handover: {}, collections: [{ room: 610, amount: 300, currency: "EGP", bookingId: b }] });
  await page.goto("/");
  await login(page, "mona");
  await goTab(page, "الحجوزات");
  await page.getByTestId("edit-price").first().click();
  await openPaySections(page);
  await page.getByTestId("form-edit-payments").getByTestId("edit-payments-open").click();
  await page.getByTestId("edit-pay-0-amount-0").fill("0");
  await page.getByTestId("edit-payment-save").click();
  await expect(toast(page)).toContainText("اتعدّلت الدفعة");
  expect(Number((await booking(env, b)).amount_paid)).toBe(0);
  const rows = (await rec(env, day, key)).rows;
  expect(rows.filter((x) => x.bookingId === b)).toHaveLength(0);          // الصف اتشال خالص
  expect(rows.filter((x) => x.room === 610)).toHaveLength(1);              // صف الغرفة رجع فاضي
  await page.keyboard.press("Escape");
  await goTab(page, "لوحة الغرف");
  await openRoom(page, 610);
  await expect(page.getByTestId("pay-panel")).toBeVisible();               // رجع عليه فلوس
  await page.getByTestId("pay-panel").getByTestId("pay-amount").fill("300");
  await page.getByTestId("pay-panel").getByTestId("pay-record").click();
  await expect(toast(page)).toContainText("تم تسجيل");
  const again = (await rec(env, day, key)).rows.filter((x) => x.bookingId === b);
  expect(again).toHaveLength(1);
  expect(Number(again[0].collectionAmt)).toBe(300);
});

test("موظف الشيفت بيعدّل دفعة في شيفت قبله النهارده اتقفل (نفس اليوم) - واليوم اللي فات لأ", async ({ page, env }) => {
  await users(env);
  const day = shiftDay(), key = myShiftKey();
  const prevKey = key === "morning" ? "evening" : "morning";          // شيفت تاني في نفس يوم الشيفت
  const b = await env.seedBooking({ room: 611, guest: "Same Day", start: 0, nights: 2, price: 100, paid: 150, currency: "EGP", anchor: "shift" });
  await env.seedShift("sara", { day, key: prevKey, closed: true, handover: {}, closingCash: { EGP: 150 }, collections: [{ room: 611, amount: 150, currency: "EGP", bookingId: b }] });
  await page.goto("/");
  await login(page, "ahmed");
  await claimShift(page);
  await goTab(page, "الحجوزات");
  await page.getByTestId("edit-price").first().click();
  await openPaySections(page);
  await page.getByTestId("form-edit-payments").getByTestId("edit-payments-open").click();
  await page.getByTestId("edit-pay-0-amount-0").fill("200");
  await page.getByTestId("edit-payment-save").click();
  await expect(toast(page)).toContainText("اتعدّلت الدفعة");
  expect(Number((await booking(env, b)).amount_paid)).toBe(200);
  const r = await rec(env, day, prevKey);
  expect(r.closed).toBe(true);
  expect(Number(r.closing_cash.EGP)).toBe(200);                         // أرقام الشيفت المقفول اتحسبت
  // يوم فات: مرفوض من القاعدة
  const old = cairoDate(-3);
  await env.seedShift("sara", { day: old, key: "morning", closed: true, handover: {}, closingCash: { EGP: 0 } });
  const denied = await env.api("ahmed", "POST", "/rest/v1/rpc/correct_shift_record", { p_hotel: 1, p_date: old, p_key: "morning", p_expected: null, p_record: { shift_notes: "x" } });
  expect(denied.status).toBeGreaterThanOrEqual(400);
});

test("دفع بعملتين مش مصري: حجز دولار والجيست دفع جزء يورو - سعر الدولار واليورو بالمصري بيتكتبوا مرة واحدة والتحويل بيعدّي على الجنيه", async ({ page, env }) => {
  await users(env);
  const day = shiftDay(), key = myShiftKey();
  // حجز 100 دولار، دفع 60 دولار
  const b = await env.seedBooking({ room: 612, guest: "Two Foreign", start: 0, nights: 2, price: 50, paid: 60, currency: "USD", anchor: "shift" });
  await env.seedShift("ahmed", { day, key, closed: false, handover: {}, collections: [{ room: 612, amount: 60, currency: "USD", bookingId: b }] });
  await page.goto("/");
  await login(page, "ahmed");
  await goTab(page, "الحجوزات");
  await page.getByTestId("edit-price").first().click();
  await openPaySections(page);
  await page.getByTestId("form-edit-payments").getByTestId("edit-payments-open").click();
  // الدفعة اتقسمت: 60 دولار + 37 يورو (الدولار بـ 50 واليورو بـ 54 = 37 × 54 ÷ 50 = 39.96 دولار)
  await page.getByTestId("edit-pay-0-add").click();
  await page.getByTestId("edit-pay-0-amount-1").fill("37");
  await page.getByTestId("edit-pay-0-currency-1").selectOption("EUR");
  await page.getByTestId("edit-pay-0-1-rate-USD").fill("50");
  await page.getByTestId("edit-pay-0-1-rate-EUR").fill("54");
  await page.getByTestId("edit-payment-save").click();
  await expect(toast(page)).toContainText("اتعدّلت الدفعة");
  expect((await env.q("select fx_rates from bookings where id = $1", [b]))[0].fx_rates).toEqual({ USD: 50, EUR: 54 });
  expect(Number((await booking(env, b)).amount_paid)).toBe(99.96);
  const eur = (await rec(env, day, key)).rows.find((x) => x.bookingId === b && x.collectionCurrency === "EUR");
  expect(eur).toMatchObject({ collectionAmt: 37, fxCovered: 39.96, fxBookingCurrency: "USD" });   // الخزينة 37 يورو فعلي
  // الباقي (0.04 دولار) بالجنيه من كارت الغرفة - السعر متحدد خلاص فمفيش خانة سعر
  await page.keyboard.press("Escape");
  await goTab(page, "لوحة الغرف");
  await openRoom(page, 612);
  const panel = page.getByTestId("pay-panel");
  await panel.getByTestId("pay-currency").selectOption("EGP");
  await expect(panel.getByTestId("pay-rate-USD")).toHaveCount(0);
  await panel.getByTestId("pay-record").click();                       // فاضي = كامل المتبقي بالجنيه (0.04 × 50 = 2 جنيه)
  await expect(toast(page)).toContainText("تم تسجيل 2 EGP");
  expect(Number((await booking(env, b)).amount_paid)).toBe(100);
});

test("فورم الحجز: خانة سعر العملة بالمصري بتتحفظ على الحجز", async ({ page, env }) => {
  await users(env);
  const b = await env.seedBooking({ room: 607, guest: "Rate Form", start: 0, nights: 1, price: 40, paid: 0, currency: "USD", anchor: "shift" });
  await page.goto("/");
  await login(page, "mona");
  await claimShift(page);
  await goTab(page, "الحجوزات");
  await page.getByTestId("edit-price").first().click();
  await expect(page.getByTestId("fx-currency")).toHaveValue("USD");
  await page.getByTestId("fx-egp").fill("51.5");
  await page.getByRole("button", { name: /حفظ الحجز/ }).click();
  await expect.poll(async () => (await env.q("select fx_rates from bookings where id = $1", [b]))[0].fx_rates).toEqual({ USD: 51.5 });
});

test("مدفوع قبل السيستم: بيتحسب في المدفوع والمتبقي من غير ما يدخل أي يومية، وفحص التطابق بيعدّي", async ({ page, env }) => {
  await users(env);
  const b = await env.seedBooking({ room: 603, guest: "Paper Guest", start: -1, nights: 3, price: 400, paid: 0, currency: "EGP" });
  await page.goto("/");
  await login(page, "ahmed");
  await claimShift(page);
  await goTab(page, "الحجوزات");
  await expect(page.getByTestId("prior-paid-open")).toHaveCount(0);  // مفيش زرار على الكارت - بيتكتب من فورم الحجز
  // موظف الشيفت مايعدّلوش على حجز موجود (بيكتبه مع الحجز الجديد بس) - لا في الفورم ولا من القاعدة
  await page.getByTestId("edit-price").first().click();
  await expect(page.getByTestId("new-prior-amount")).toHaveCount(0);
  await env.qRaw(`set session_replication_role = replica; update bookings set created_at = now() - interval '2 hours' where id = '${b}'; set session_replication_role = origin;`);   // حجز قديم (مش لسه متعمل)
  const staffTry = await env.api("ahmed", "POST", "/rest/v1/rpc/set_booking_prior_paid", { p_booking: b, p_amount: 100, p_note: null, p_expected: null });
  expect(staffTry.status).toBeGreaterThanOrEqual(400);
  expect(JSON.stringify(staffTry.body)).toContain("مدير الشيفت");
  // مدير الشيفت هو اللي بيعدّله (بياخد نفس الشيفت بدل الموظف)
  await env.qRaw("delete from shift_records; delete from shift_claims;");
  await logout(page);
  await login(page, "mona");
  await claimShift(page);
  await goTab(page, "الحجوزات");
  await page.getByTestId("edit-price").first().click();
  await openPaySections(page);
  await page.getByTestId("new-prior-amount").fill("700");
  await page.getByTestId("new-prior-note").fill("دفع كاش يوم 10/11");
  await page.getByRole("button", { name: /حفظ الحجز/ }).click();
  await expect(toast(page)).toContainText("مدفوع قبل السيستم");
  const row = await booking(env, b);
  expect(Number(row.amount_paid)).toBe(700);
  expect(Number(row.payment_details.priorPaid)).toBe(700);
  expect(row.payment_details.priorPaidNote).toBe("دفع كاش يوم 10/11");
  expect((await env.q("select count(*)::int n from shift_records, jsonb_array_elements(rows) r where calma_num(r ->> 'collectionAmt') <> 0 or coalesce(r ->> 'bookingId', '') <> ''"))[0].n).toBe(0);   // مادخلش أي يومية
  await expect(page.getByText("منها قبل السيستم").first()).toBeVisible();
  // تعديل الحجز من الـ API مايمسحش المبلغ ده
  await env.seedUser("rawan", "reservations", "روان");
  await env.api("rawan", "PATCH", `/rest/v1/bookings?id=eq.${b}`, { payment_details: { senderName: "", senderNumber: "", ref: "", onlinePaid: false }, notes: "x" });
  expect(Number((await booking(env, b)).payment_details.priorPaid)).toBe(700);
  // أكتر من المطلوب بيترفض
  const over = await env.api("devo", "POST", "/rest/v1/rpc/set_booking_prior_paid", { p_booking: b, p_amount: 5000, p_note: null, p_expected: null });
  expect(over.status).toBeGreaterThanOrEqual(400);
  // المدير العام (عرض فقط) مايسجّلوش
  expect((await env.api("boss", "POST", "/rest/v1/rpc/set_booking_prior_paid", { p_booking: b, p_amount: 100, p_note: null, p_expected: null })).status).toBeGreaterThanOrEqual(400);
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
  expect(cells).toEqual(["فيزا", "EGP", "0", "1,200", "—", "1,700"]);       // الإجمالي = رصيد آخر شيفت بالعهدة اللي اتكتبت
});

test("المطوّر يمسح حجز اتضاف بالغلط نهائيًا: تحصيله بيتشال من اليومية المقفولة والعهدة بتتظبط، والحجز بيختفي", async ({ page, env }) => {
  await users(env);
  const d2 = cairoDate(-2), d1 = cairoDate(-1);
  const b = await env.seedBooking({ room: 601, guest: "Wrong Booking", start: -2, nights: 3, price: 500, paid: 800, currency: "EGP" });
  const keep = await env.seedBooking({ room: 602, guest: "Real Guest", start: -2, nights: 3, price: 500, paid: 300, currency: "EGP" });
  await env.seedShift("ahmed", { day: d2, key: "morning", closed: true, handover: { EGP: 100 }, closingCash: { EGP: 1200 },
    collections: [{ room: 601, amount: 800, currency: "EGP", bookingId: b }, { room: 602, amount: 300, currency: "EGP", bookingId: keep }] });
  await env.seedShift("ahmed", { day: d1, key: "morning", closed: true, handover: { EGP: 1200 }, closingCash: { EGP: 1200 } });
  await page.goto("/");
  await login(page, "devo");
  await goTab(page, "الحجوزات");
  await openMoreMenus(page);
  const del = page.locator("div", { has: page.getByTestId("dev-delete-booking") }).filter({ hasText: "Wrong Booking" }).last().getByTestId("dev-delete-booking").getByRole("button");
  await del.click();
  await del.first().click();                                           // تأكيد
  await expect(toast(page)).toContainText("نهائيًا");
  expect(await env.q("select id from bookings where id = $1", [b])).toHaveLength(0);
  const first = await rec(env, d2, "morning");
  expect(first.rows.filter((r) => r.room === 601)).toHaveLength(1);
  expect(Number(first.rows.find((r) => r.room === 601).collectionAmt) || 0).toBe(0);
  expect(Number(first.rows.find((r) => r.room === 602).collectionAmt)).toBe(300);       // تحصيل الحجز التاني زي ما هو
  expect(first.closing_cash).toEqual({ EGP: 400 });
  expect((await rec(env, d1, "morning")).handover).toEqual({ EGP: 400 });
  expect(Number((await booking(env, keep)).amount_paid)).toBe(300);
  expect((await env.q("select count(*)::int n from activity_log where action like 'مسح نهائي لحجز%' and username = 'devo'"))[0].n).toBe(1);
  // غير المطوّر مايقدرش
  expect((await env.api("boss", "POST", "/rest/v1/rpc/dev_delete_booking", { p_booking: keep })).status).toBeGreaterThanOrEqual(400);
  expect(await env.q("select id from bookings where id = $1", [keep])).toHaveLength(1);
});

test("المطوّر يمسح يومية اتفتحت بالغلط، ويرجّع حجز اتلغى أو اتغادر مبكرًا بالغلط", async ({ page, env }) => {
  await users(env);
  const d1 = cairoDate(-1);
  const b = await env.seedBooking({ room: 603, guest: "Shift Guest", start: -1, nights: 3, price: 400, paid: 400, currency: "EGP" });
  await env.seedShift("sara", { day: d1, key: "evening", closed: true, handover: { EGP: 0 }, closingCash: { EGP: 400 }, collections: [{ room: 603, amount: 400, currency: "EGP", bookingId: b }] });
  await page.goto("/");
  await login(page, "devo");
  await openHistory(page, d1, "evening");
  const del = page.getByTestId("dev-delete-shift").getByRole("button");
  await del.click();
  await del.first().click();
  await expect(toast(page)).toContainText("تم مسح اليومية");
  expect(await env.q("select 1 from shift_records where date = $1", [d1])).toHaveLength(0);
  expect(await env.q("select 1 from shift_claims where date = $1", [d1])).toHaveLength(0);
  expect(Number((await booking(env, b)).amount_paid)).toBe(0);                     // تحصيل اليومية الممسوحة اتشال من الحجز

  // إلغاء بالغلط: المطوّر يرجّع الحجز
  await env.qRaw("update bookings set status = 'ملغي' where id = $1", [b]);
  const un = await env.api("devo", "PATCH", `/rest/v1/bookings?id=eq.${b}`, { status: "مؤكد" });
  expect(un.status, JSON.stringify(un.body)).toBeLessThan(300);
  expect((await env.q("select status from bookings where id = $1", [b]))[0].status).toBe("مؤكد");
  // مغادرة مبكرة بالغلط: يرجّع تاريخ الخروج والحالة
  const out = cairoDate(2);
  await env.qRaw("update bookings set left_early = true, status = 'تم تسجيل الخروج', checkout = $2, total_room = 400 where id = $1", [b, cairoDate(0)]);
  const back = await env.api("devo", "PATCH", `/rest/v1/bookings?id=eq.${b}`, { left_early: false, status: "تم تسجيل الدخول", checkout: out, total_room: 1200 });
  expect(back.status, JSON.stringify(back.body)).toBeLessThan(300);
  expect((await env.q("select left_early, status, checkout::text, total_room from bookings where id = $1", [b]))[0]).toMatchObject({ left_early: false, status: "تم تسجيل الدخول", checkout: out });
});

test("رسوم الفيزا: الموظف بيكتب الرسم مع الدفعة - بيتحسب على النزيل وبيتسجّل في اليومية صف لوحده 'رسوم فيزا' وبيدخل في إجمالي الفيزا", async ({ page, env }) => {
  await users(env);
  const b = await env.seedBooking({ room: 604, guest: "Visa Guest", start: 0, nights: 2, price: 1000, paid: 0, currency: "EGP", anchor: "shift" });
  await env.seedShift("ahmed", {});
  await page.goto("/");
  await login(page, "ahmed");
  await goTab(page, "الحجوزات");
  const card = page.locator("div", { has: page.getByTestId("quickpay-open") }).filter({ hasText: "Visa Guest" }).last();
  await card.getByTestId("quickpay-open").click();
  await page.getByTestId("quickpay-amount").fill("2000");
  await page.getByTestId("quickpay-method").selectOption("فيزا");
  await page.getByTestId("quickpay-last4").fill("4321");
  await page.getByTestId("quickpay-visa-fee").fill("60");
  await page.getByTestId("quickpay-submit").click();
  await expect(toast(page)).toContainText("رسوم فيزا 60");
  const row = (await env.q("select amount_paid, extras, settled from bookings where id = $1", [b]))[0];
  expect(Number(row.amount_paid)).toBe(2060);
  expect(Number(row.extras.visaFee)).toBe(60);
  expect(row.settled).toBe(true);                                                  // الإجمالي = 2000 + 60 رسوم، والمدفوع 2060
  const shift = (await env.q("select rows from shift_records"))[0];
  const feeRow = shift.rows.find((r) => r.visaFee);
  expect(feeRow).toMatchObject({ room: 604, collectionAmt: 60, collectionMethod: "فيزا", collectionCurrency: "EGP" });
  expect(feeRow.collectionDesc).toContain("رسوم فيزا");
  // فحص التطابق: المدفوع = تحصيل اليومية (الدفعة + الرسوم)
  const res = await env.pool.query(readFileSync(new URL("../../supabase/ops/reconcile.sql", import.meta.url), "utf8"));
  const rows = (Array.isArray(res) ? res : [res]).flatMap((r) => r.rows || []);
  expect(rows.filter((r) => r.level === "خطأ")).toEqual([]);
  // تقرير الأونر: الرسوم بتظهر في خدمات الغرفة، وإجمالي الفيزا = 2,060
  await goTab(page, "اليومية");
  await page.getByTestId("owner-report-btn").click();
  const r604 = (await page.getByTestId("owner-sheet-rooms").locator("tbody tr", { hasText: "604" }).first().innerText()).replace(/[⁦-⁩]/g, "");
  expect(r604).toContain("رسوم فيزا 60 EGP");
  const visaBox = page.locator("[data-testid^='owner-sheet-shift-'] .cx-or-sum > div", { hasText: "الفيزا" }).first().locator("dd");
  expect((await visaBox.innerText()).replace(/[⁦-⁩]/g, "")).toBe("2,060 EGP");
});

test("حجز جديد: الموظف بيكتب مدفوع قبل السيستم ورسوم الفيزا مع العربون من فورم الحجز نفسه", async ({ page, env }) => {
  await users(env);
  await env.seedShift("ahmed", {});
  await page.goto("/");
  await login(page, "ahmed");
  await addBooking(page, { room: 607, guest: "Form Guest", nights: 2, price: 1000, currency: "EGP", paid: 500, method: "فيزا", last4: "1234", visaFee: 25, prior: 800, priorNote: "حوّل قبل السيستم", expectSaved: false });
  await expect(toast(page)).toContainText("رسوم فيزا 25");
  await expect(toast(page)).toContainText("مدفوع قبل السيستم");
  const row = (await env.q("select amount_paid, extras, payment_details from bookings where guest_name = 'Form Guest'"))[0];
  expect(Number(row.amount_paid)).toBe(1325);                         // 500 عربون + 25 رسوم + 800 قبل السيستم
  expect(Number(row.extras.visaFee)).toBe(25);
  expect(Number(row.payment_details.priorPaid)).toBe(800);
  expect(row.payment_details.priorPaidNote).toBe("حوّل قبل السيستم");
  // اليومية فيها العربون والرسوم بس - الـ 800 مادخلتش الخزينة
  const rows = (await env.q("select rows from shift_records"))[0].rows.filter((r) => r.bookingId);
  expect(rows.map((r) => Number(r.collectionAmt)).sort((a, b) => a - b)).toEqual([25, 500]);
  await expect(page.getByText("منها رسوم فيزا").first()).toBeVisible();
  await expect(page.getByText("منها قبل السيستم").first()).toBeVisible();
});

test("المطوّر يغيّر عملة حجز ليه تحصيل في يومية مقفولة: العملة بتتغيّر في اليومية وأرقامها والعهدة اللي بعدها بيتحسبوا", async ({ page, env }) => {
  await users(env);
  const d2 = cairoDate(-2), d1 = cairoDate(-1);
  const b = await env.seedBooking({ room: 608, guest: "Wrong Currency", start: -2, nights: 4, price: 200, paid: 800, currency: "EGP" });
  await env.seedShift("ahmed", { day: d2, key: "morning", closed: true, handover: { EGP: 100 }, closingCash: { EGP: 900 }, collections: [{ room: 608, amount: 800, currency: "EGP", bookingId: b }] });
  await env.seedShift("ahmed", { day: d1, key: "morning", closed: true, handover: { EGP: 900 }, closingCash: { EGP: 900 } });
  // الموظف العادي لسه ممنوع
  expect((await env.api("ahmed", "POST", "/rest/v1/rpc/change_booking_currency", { p_booking: b, p_currency: "USD", p_expected: null })).status).toBeGreaterThanOrEqual(400);
  await page.goto("/");
  await login(page, "devo");
  await openRoom(page, 608);
  await expect(page.getByTestId("currency-open")).toHaveCount(0);          // زرار تعديل العملة اتشال من كارت الغرفة
  // العملة بتتغيّر من فورم "تعديل الحجز"
  await goTab(page, "الحجوزات");
  await page.getByRole("button", { name: "تعديل الحجز", exact: true }).first().click();
  await page.locator("xpath=//label[contains(.,'السعر لليلة')]/following-sibling::div//select").selectOption("USD");
  await page.getByRole("button", { name: /حفظ الحجز/ }).click();
  await expect(toast(page)).toContainText("العملة اتغيّرت من EGP لـ USD");
  expect((await env.q("select currency from bookings where id = $1", [b]))[0].currency).toBe("USD");
  const fixed = await rec(env, d2, "morning");
  expect(fixed.rows.find((r) => r.room === 608).collectionCurrency).toBe("USD");
  expect(fixed.closed).toBe(true);
  expect(Number(fixed.closing_cash.USD)).toBe(800);
  expect(Number(fixed.closing_cash.EGP || 0)).toBe(100);
  const next = await rec(env, d1, "morning");
  expect(Number(next.handover.USD)).toBe(800);
  expect(Number(next.handover.EGP || 0)).toBe(100);
});

test("المطوّر يسجّل دفعة (ورسوم فيزا) من غير ما ياخد شيفت: بتدخل الشيفت المفتوح في فندق الحجز", async ({ page, env }) => {
  await users(env);
  const b = await env.seedBooking({ room: 609, guest: "Dev Pays", start: 0, nights: 2, price: 500, paid: 0, currency: "EGP", anchor: "shift" });
  // مفيش شيفت مفتوح: الدفعة بتترفض برسالة واضحة
  const none = await env.api("devo", "POST", "/rest/v1/rpc/record_booking_payment", { p_booking: b, p_amount: 100, p_method: "كاش", p_details: {}, p_note: "تحصيل", p_expected: null });
  expect(JSON.stringify(none.body)).toContain("مفيش شيفت مفتوح");
  await env.seedShift("ahmed", {});
  await page.goto("/");
  await login(page, "devo");
  await goTab(page, "الحجوزات");
  const card = page.locator("div", { has: page.getByTestId("quickpay-open") }).filter({ hasText: "Dev Pays" }).last();
  await card.getByTestId("quickpay-open").click();
  await page.getByTestId("quickpay-amount").fill("1000");
  await page.getByTestId("quickpay-method").selectOption("فيزا");
  await page.getByTestId("quickpay-last4").fill("9876");
  await page.getByTestId("quickpay-visa-fee").fill("30");
  await page.getByTestId("quickpay-submit").click();
  await expect(toast(page)).toContainText("رسوم فيزا 30");
  expect(Number((await booking(env, b)).amount_paid)).toBe(1030);
  const rows = (await env.q("select rows from shift_records"))[0].rows.filter((r) => r.bookingId === b);
  expect(rows.map((r) => Number(r.collectionAmt)).sort((x, y) => x - y)).toEqual([30, 1000]);
});

test("المطوّر بكل الصلاحيات: بيشتغل على الشيفت المفتوح (كافيتيريا استاف وإقفال) وبيسجّل عربون في حجز جديد من غير ما ياخد شيفت", async ({ page, env }) => {
  await users(env);
  await page.goto("/");
  await login(page, "devo");
  await goTab(page, "اليومية");
  await expect(page.getByTestId("dev-no-open-shift")).toBeVisible();          // مفيش شيفت مفتوح: رسالة بدل اختيار شيفت
  await env.seedShift("ahmed", {});
  await page.reload();
  await goTab(page, "اليومية");
  await page.getByTestId("staff-cafe-who").selectOption("sara");
  await page.getByTestId("staff-cafe-amount").fill("40");
  await page.getByTestId("staff-cafe-add").click();
  await expect(toast(page)).toContainText("سارة");
  expect((await env.q("select consumer_username, amount::float from staff_cafeteria"))[0]).toEqual({ consumer_username: "sara", amount: 40 });
  // المطوّر بيعدّل استهلاك الاستاف (المبلغ والبيان) ويمسحه
  await page.getByTestId("staff-cafe-entry").first().getByTestId("staff-cafe-fix").click();
  await page.getByTestId("staff-cafe-fix-amount").fill("35");
  await page.getByTestId("staff-cafe-fix-desc").fill("قهوة");
  await page.getByTestId("staff-cafe-fix-save").click();
  await expect(toast(page)).toContainText("تم تعديل الاستهلاك");
  expect((await env.q("select description, amount::float from staff_cafeteria"))[0]).toEqual({ description: "قهوة", amount: 35 });
  // استهلاك مدفوع كاش: تحصيله في كافيتيريا اليومية بيتعدّل من المطوّر
  await page.getByTestId("staff-cafe-who").selectOption("ahmed");
  await page.getByTestId("staff-cafe-amount").fill("60");
  await page.getByTestId("staff-cafe-paymode").selectOption("كاش");
  await page.getByTestId("staff-cafe-add").click();
  await expect(toast(page)).toContainText("السداد");
  await page.getByTestId("cafeteria-row").first().getByTestId("cafe-row-edit").click();
  await page.getByTestId("cafe-row-amount").fill("55");
  await page.getByTestId("cafe-row-save").click();
  await expect(toast(page)).toContainText("تم تعديل تحصيل الكافيتيريا");
  expect(Number((await env.q("select cafeteria_rows from shift_records"))[0].cafeteria_rows[0].collectionAmt)).toBe(55);
  // ومسح استهلاك مالوش سداد
  await page.getByTestId("staff-cafe-entry").filter({ hasText: "قهوة" }).getByTestId("staff-cafe-fix").click();
  await page.getByTestId("staff-cafe-fix-delete").click();
  await expect(toast(page)).toContainText("اتمسح الاستهلاك");
  expect((await env.q("select count(*)::int n from staff_cafeteria where description = 'قهوة'"))[0].n).toBe(0);
  // عربون في حجز جديد بيدخل نفس الشيفت المفتوح
  await addBooking(page, { room: 610, guest: "Dev Deposit", nights: 1, price: 300, currency: "EGP", paid: 100, prior: 50 });
  const bk = (await env.q("select amount_paid, payment_details from bookings where guest_name = 'Dev Deposit'"))[0];
  expect(Number(bk.amount_paid)).toBe(150);
  expect((await env.q("select rows from shift_records"))[0].rows.filter((r) => r.bookingId).map((r) => Number(r.collectionAmt))).toEqual([100]);
  // إقفال الشيفت المفتوح
  await goTab(page, "اليومية");
  await page.getByRole("button", { name: "إقفال الشيفت" }).click();
  await expect.poll(async () => (await env.q("select closed from shift_records"))[0].closed).toBe(true);
});

test("مدير الشيفت يعدّل كل تفاصيل الحجز (الغرفة والدخول والسعر) والمدفوع: الدفعة بتتعدّل في اليومية والمدفوع والخزينة بيتظبطوا", async ({ page, env }) => {
  await users(env);
  const day = shiftDay(), key = myShiftKey();
  const b = await env.seedBooking({ room: 611, guest: "Full Edit", start: 0, nights: 2, price: 500, paid: 500, currency: "EGP", anchor: "shift" });
  await env.seedShift("mona", { day, key, handover: { EGP: 0 }, collections: [{ room: 611, amount: 500, currency: "EGP", bookingId: b, method: "كاش", desc: "تحصيل حجز جديد - Full Edit (+500 EGP)" }] });
  // الموظف العادي لسه مايقدرش يغيّر الغرفة أو الدخول من غير "نقل النزيل"
  const denied = await env.api("ahmed", "PATCH", `/rest/v1/bookings?id=eq.${b}`, { checkin: cairoDate(-1) });
  expect(denied.status).toBeGreaterThanOrEqual(400);
  await page.goto("/");
  await login(page, "mona");
  await goTab(page, "الحجوزات");
  await page.getByTestId("edit-price").first().click();
  const form = page.locator(".cx-card[data-calma-editing]");
  await expect(form).toBeInViewport();                                     // الفورم بيظهر قدامك لوحده
  await form.locator("select.cx-select").first().selectOption("612");      // الغرفة مش مقفولة على مدير الشيفت
  await page.locator("xpath=//label[contains(.,'السعر لليلة')]/following-sibling::div//input[@type='number']").fill("450");
  await form.getByRole("button", { name: /حفظ الحجز/ }).click();
  await expect(toast(page)).toContainText("تم الحفظ");
  const row = (await env.q("select room, price_night::float, total_room::float from bookings where id = $1", [b]))[0];
  expect(row).toEqual({ room: 612, price_night: 450, total_room: 900 });
  // تعديل المدفوع: مش على الكارت - جوه فورم "تعديل الحجز". الدفعة 500 كاش بقت 400 فيزا
  await expect(page.getByTestId("booking-card").getByTestId("edit-payments-open")).toHaveCount(0);
  await page.getByTestId("edit-price").first().click();
  await openPaySections(page);
  await page.getByTestId("form-edit-payments").getByTestId("edit-payments-open").click();
  await page.getByTestId("edit-pay-0-amount-0").fill("400");
  await page.getByTestId("edit-pay-0-method-0").selectOption("فيزا");
  await page.getByTestId("edit-pay-0-0-last4").fill("5555");
  await page.getByTestId("edit-pay-0-fee-0").fill("50");          // رسوم فيزا على الدفعة القديمة
  await page.getByTestId("edit-payment-save").click();
  await expect(toast(page)).toContainText("اتضافت رسوم فيزا 50 EGP");
  const after = await env.q("select amount_paid::float, (extras ->> 'visaFee')::float fee from bookings where id = $1", [b]);
  expect(after[0]).toEqual({ amount_paid: 450, fee: 50 });             // الرسم اتحسب على النزيل واتدفع
  const feeRow = (await rec(env, day, key)).rows.find((x) => x.bookingId === b && x.visaFee);
  expect(feeRow).toMatchObject({ collectionAmt: 50, collectionMethod: "فيزا", collectionDesc: "رسوم فيزا - Full Edit (+50 EGP)" });
  const r = (await rec(env, day, key)).rows.find((x) => x.bookingId === b);
  expect(r).toMatchObject({ collectionAmt: 400, collectionMethod: "فيزا", collectionDesc: "تحصيل حجز جديد - Full Edit (+400 EGP)" });   // البيان اتعدّل مع المبلغ
  expect(r.visaFee).toBeUndefined();
  // الفورم لسه مفتوح وبيتحفظ عادي بعد تعديل المدفوع (من غير "اتحدّث من مكان تاني")
  await page.getByRole("button", { name: /حفظ الحجز/ }).click();
  await expect(toast(page)).toContainText("تم الحفظ");
  expect((await env.q("select amount_paid::float, (extras ->> 'visaFee')::float fee from bookings where id = $1", [b]))[0]).toEqual({ amount_paid: 450, fee: 50 });
  const res = await env.pool.query(readFileSync(new URL("../../supabase/ops/reconcile.sql", import.meta.url), "utf8"));
  const rows = (Array.isArray(res) ? res : [res]).flatMap((x) => x.rows || []);
  expect(rows.filter((x) => x.level === "خطأ")).toEqual([]);
});

test("دفعة اتمسح مبلغها من اليومية: مابتظهرش في 'تعديل المدفوع' (الممسوح مخفي)", async ({ page, env }) => {
  await users(env);
  const d1 = cairoDate(-1);
  const b = await env.seedBooking({ room: 612, guest: "Erased Pay", start: -1, nights: 3, price: 1000, paid: 0, currency: "EGP" });
  await env.seedShift("ahmed", { day: d1, key: "morning", closed: true, handover: { EGP: 0 }, closingCash: { EGP: 0 }, collections: [{ room: 612, amount: "", currency: "EGP", method: "كاش", bookingId: b, desc: "تحصيل حجز جديد - Erased Pay (+3000 EGP)" }] });
  await page.goto("/");
  await login(page, "devo");
  await goTab(page, "الحجوزات");
  await page.getByRole("button", { name: "تعديل الحجز", exact: true }).first().click();
  await openPaySections(page);
  await page.getByTestId("form-edit-payments").getByTestId("edit-payments-open").click();
  await expect(page.getByTestId("edit-payments")).toContainText("مفيش دفعات متسجّلة");
  await expect(page.getByTestId("edit-payment-row")).toHaveCount(0);
});

test("المطوّر: زرار إرجاع حجز اتلغى بالغلط، وزرار إلغاء مغادرة مبكرة اتسجّلت بالغلط (بيرجع تاريخ الخروج والإجمالي الأصليين)", async ({ page, env }) => {
  await users(env);
  const c = await env.seedBooking({ room: 605, guest: "Cancelled By Mistake", start: 0, nights: 2, price: 300, currency: "EGP", status: "ملغي" });
  const e = await env.seedBooking({ room: 606, guest: "Early By Mistake", start: -2, nights: 5, price: 300, currency: "EGP", status: "تم تسجيل الدخول" });
  const origOut = cairoDate(3);
  // مغادرة مبكرة بالغلط النهارده: تريجر الذاكرة بيحفظ الخروج والإجمالي الأصليين
  await env.q("update bookings set left_early = true, status = 'تم تسجيل الخروج', checkout = $2, total_room = 600 where id = $1", [e, cairoDate(0)]);
  expect((await env.q("select pre_early_checkout::text from bookings where id = $1", [e]))[0].pre_early_checkout).toBe(origOut);
  await page.goto("/");
  await login(page, "devo");
  await goTab(page, "الحجوزات");
  await openMoreMenus(page);
  await page.getByRole("button", { name: "إرجاع الحجز (اتلغى بالغلط)" }).click();
  await page.getByRole("button", { name: "ترجّع الحجز؟" }).click();
  await expect(toast(page)).toContainText("الحجز رجع تاني");
  expect((await env.q("select status from bookings where id = $1", [c]))[0].status).toBe("تم تسجيل الدخول");
  await page.getByRole("button", { name: "إلغاء المغادرة المبكرة" }).click();
  await page.getByRole("button", { name: "ترجّع تاريخ الخروج الأصلي؟" }).click();
  await expect(toast(page)).toContainText("المغادرة المبكرة اتلغت");
  expect((await env.q("select left_early, status, checkout::text, total_room::float as total_room from bookings where id = $1", [e]))[0]).toEqual({ left_early: false, status: "تم تسجيل الدخول", checkout: origOut, total_room: 1500 });
  expect((await env.q("select count(*)::int n from activity_log where username = 'devo' and (action like 'إرجاع حجز%' or action like 'إلغاء مغادرة%')"))[0].n).toBe(2);
  // غير المطوّر مايقدرش
  expect((await env.api("boss", "POST", "/rest/v1/rpc/dev_restore_booking", { p_booking: c, p_what: "uncancel" })).status).toBeGreaterThanOrEqual(400);
});

test("موظف الشيفت يعدّل بيانات النزيل (الاسم والتليفون وعدد الأفراد وجهة الحجز) من الحجوزات - والغرفة وتاريخ الدخول ثابتين", async ({ page, env }) => {
  await users(env);
  const b = await env.seedBooking({ room: 607, guest: "Old Name", start: 0, nights: 2, price: 300, currency: "EGP", anchor: "shift" });
  await env.seedShift("ahmed", {});
  await page.goto("/");
  await login(page, "ahmed");
  await goTab(page, "الحجوزات");
  await page.getByTestId("edit-price").first().click();
  await page.locator("xpath=//label[normalize-space(.)='اسم النزيل']/following-sibling::*[1]").fill("New Name");
  await expect(page.locator("xpath=//label[starts-with(normalize-space(.),'الغرفة')]/following-sibling::select")).toBeDisabled();
  await expect(page.locator("xpath=//label[normalize-space(.)='تاريخ الدخول']/following-sibling::input")).toBeDisabled();
  await page.getByRole("button", { name: /^حفظ/ }).last().click();
  await expect(toast(page)).toContainText("تم الحفظ");
  expect((await env.q("select guest_name from bookings where id = $1", [b]))[0].guest_name).toBe("New Name");
  // من الـ API: بيانات النزيل مسموحة، والغرفة وتاريخ الدخول لأ
  expect((await env.api("ahmed", "PATCH", `/rest/v1/bookings?id=eq.${b}`, { phone: "01000000000", pax: 2, source: "Booking.com" })).status).toBeLessThan(300);
  expect((await env.q("select phone, pax, source from bookings where id = $1", [b]))[0]).toEqual({ phone: "01000000000", pax: 2, source: "Booking.com" });
  expect((await env.api("ahmed", "PATCH", `/rest/v1/bookings?id=eq.${b}`, { checkin: cairoDate(-3) })).status).toBeGreaterThanOrEqual(400);
  expect((await env.api("ahmed", "PATCH", `/rest/v1/bookings?id=eq.${b}`, { room: 608 })).status).toBeGreaterThanOrEqual(400);
});

test("المطوّر يعدّل سعر حجز موجود من الفورم (مش مقفول عليه)، وفورم التعديل فيه تحصيل دلوقتي", async ({ page, env }) => {
  await users(env);
  const b = await env.seedBooking({ room: 608, guest: "Price Fix", start: 0, nights: 2, price: 500, currency: "EGP", anchor: "shift" });
  await page.goto("/");
  await login(page, "devo");
  await goTab(page, "الحجوزات");
  await page.getByRole("button", { name: "تعديل الحجز" }).first().click();
  const price = page.locator("xpath=//label[starts-with(normalize-space(.),'السعر لليلة')]/following-sibling::*//input").first();
  await expect(price).toBeEnabled();
  await price.fill("450");
  await expect(page.getByTestId("advance-payment")).toContainText("تحصيل دلوقتي");
  await page.getByRole("button", { name: /^حفظ/ }).last().click();
  await expect(toast(page)).toContainText("تم الحفظ");
  expect(Number((await env.q("select price_night from bookings where id = $1", [b]))[0].price_night)).toBe(450);
});

test("مدير الشيفت بيعدّل حجز نزيل مشي (غادر مبكرًا / تم تسجيل الخروج) ومدفوعه - مفيش قفل بعد ما النزيل يخرج", async ({ page, env }) => {
  await users(env);
  const day = shiftDay(), key = myShiftKey();
  const b = await env.seedBooking({ room: 613, guest: "Gone Guest", start: -3, nights: 3, price: 200, paid: 600, currency: "EGP", status: "تم تسجيل الخروج", anchor: "shift" });
  await env.q("update bookings set left_early = true where id = $1", [b]);
  await env.seedShift("mona", { day, key, handover: { EGP: 0 }, collections: [{ room: 613, amount: 600, currency: "EGP", bookingId: b, method: "كاش", desc: "تحصيل - Gone Guest (+600 EGP)" }] });
  await page.goto("/");
  await login(page, "mona");
  await goTab(page, "الحجوزات");
  const card = page.getByTestId("booking-card").filter({ hasText: "Gone Guest" });
  await card.getByTestId("edit-price").click();
  await openPaySections(page);
  await page.getByTestId("form-edit-payments").getByTestId("edit-payments-open").click();
  await page.getByTestId("edit-pay-0-amount-0").fill("550");
  await page.getByTestId("edit-payment-save").click();
  await expect(toast(page)).toContainText("اتعدّلت الدفعة");
  expect(Number((await booking(env, b)).amount_paid)).toBe(550);
});

test("المطوّر بيلغي تسجيل خروج اتعمل بالغلط: النزيل بيرجع ساكن والتواريخ والحساب زي ما هم", async ({ page, env }) => {
  await users(env);
  const b = await env.seedBooking({ room: 608, guest: "Out By Mistake", start: -1, nights: 1, price: 1800, paid: 1800, currency: "EGP", status: "تم تسجيل الخروج" });
  await page.goto("/");
  await login(page, "devo");
  await goTab(page, "الحجوزات");
  const card = page.getByTestId("booking-card").filter({ hasText: "Out By Mistake" });
  await card.getByTestId("booking-more").locator("summary").click();
  await card.getByTestId("dev-restore").getByRole("button").first().click();
  await card.getByTestId("dev-restore").getByRole("button", { name: /ترجّع/ }).click();
  await expect(toast(page)).toContainText("تسجيل الخروج اتلغى");
  expect((await env.q("select status, total_room::float, amount_paid::float from bookings where id = $1", [b]))[0]).toEqual({ status: "تم تسجيل الدخول", total_room: 1800, amount_paid: 1800 });
  // موظف الشيفت مايقدرش يستخدم الدالة دي
  expect((await env.api("ahmed", "POST", "/rest/v1/rpc/dev_restore_booking", { p_booking: b, p_what: "uncheckout" })).status).toBeGreaterThanOrEqual(400);
});

test("تعديل الحجز: مدير الشيفت بيحصّل من الفورم بأكتر من وسيلة في نفس المرة (كاش + فيزا + انستاباي)", async ({ page, env }) => {
  await users(env);
  const b = await env.seedBooking({ room: 609, guest: "Split Edit", start: 0, nights: 2, price: 500, paid: 0, currency: "EGP", anchor: "shift" });
  await page.goto("/");
  await login(page, "mona");
  await claimShift(page);
  await goTab(page, "الحجوزات");
  await page.getByTestId("edit-price").first().click();
  await openPaySections(page);
  await page.getByTestId("advance-amount").fill("400");                 // 400 كاش
  await page.getByTestId("advance-add-line").click();
  await page.getByTestId("advance-extra-amount-0").fill("300");          // 300 فيزا
  await page.getByTestId("advance-extra-method-0").selectOption("فيزا");
  await page.getByTestId("advance-extra-0-last4").fill("1111");
  await page.getByTestId("advance-add-line").click();
  await page.getByTestId("advance-extra-amount-1").fill("300");          // 300 انستاباي
  await page.getByTestId("advance-extra-method-1").selectOption("تحويل بنكي / انستاباي");
  await page.getByTestId("advance-extra-1-name").fill("Ali");
  await page.getByTestId("advance-extra-1-phone").fill("01001234567");
  await page.getByRole("button", { name: /حفظ الحجز/ }).click();
  await expect(toast(page)).toContainText("تم الحفظ");
  expect(Number((await env.q("select amount_paid from bookings where id = $1", [b]))[0].amount_paid)).toBe(1000);
  const rows = await env.q("select r->>'collectionCurrency' cur, r->>'collectionMethod' m, calma_num(r->>'collectionAmt')::float amt from shift_records s, jsonb_array_elements(s.rows) r where r->>'bookingId' = $1 and calma_num(r->>'collectionAmt') > 0 order by 3", [b]);
  expect(rows.map((r) => `${r.amt} ${r.cur} ${r.m}`).sort()).toEqual(["300 EGP فيزا", "300 EGP تحويل بنكي / انستاباي", "400 EGP كاش"].sort());
});

test("تعديل المدفوع مباشر: مدير الشيفت بيعدّل دفعة متسجّلة غلط (3600 كاش) لـ 2500 كاش + جزء تاني 1100 فيزا - المدفوع والخزينة بيتظبطوا", async ({ page, env }) => {
  await users(env);
  const day = shiftDay(), key = myShiftKey();
  const b = await env.seedBooking({ room: 614, guest: "Split Fix", start: 0, nights: 2, price: 1800, paid: 3600, currency: "EGP", anchor: "shift" });
  await env.seedShift("mona", { day, key, handover: { EGP: 0 }, collections: [{ room: 614, amount: 3600, currency: "EGP", bookingId: b, method: "كاش", desc: "تحصيل - Split Fix (+3600 EGP)" }] });
  await page.goto("/");
  await login(page, "mona");
  await goTab(page, "الحجوزات");
  await page.getByTestId("edit-price").first().click();
  await openPaySections(page);
  await page.getByTestId("form-edit-payments").getByTestId("edit-payments-open").click();
  // تعديل مباشر: الدفعة (3600 كاش) بقت 2500 كاش + جزء تاني 1100 فيزا
  await page.getByTestId("edit-pay-0-amount-0").fill("2500");
  await page.getByTestId("edit-pay-0-add").click();
  await page.getByTestId("edit-pay-0-amount-1").fill("1100");
  await page.getByTestId("edit-pay-0-method-1").selectOption("فيزا");
  await page.getByTestId("edit-pay-0-1-last4").fill("7777");
  await page.getByTestId("edit-payment-save").click();
  await expect(toast(page)).toContainText("اتعدّلت الدفعة");
  expect(Number((await booking(env, b)).amount_paid)).toBe(3600);
  const r = await rec(env, day, key);
  const mine = r.rows.filter((x) => x.bookingId === b && Number(x.collectionAmt) > 0).map((x) => `${x.collectionAmt} ${x.collectionCurrency} ${x.collectionMethod}${x.fxCovered != null ? " =" + x.fxCovered : ""}`);
  expect(mine.sort()).toEqual(["1100 EGP فيزا", "2500 EGP كاش"].sort());
  const res = await env.pool.query(readFileSync(new URL("../../supabase/ops/reconcile.sql", import.meta.url), "utf8"));
  const rows = (Array.isArray(res) ? res : [res]).flatMap((x) => x.rows || []);
  expect(rows.filter((x) => x.level === "خطأ")).toEqual([]);
});

test("الدفع من كارت الغرفة بأكتر من وسيلة في نفس المرة: المبلغ الأول فاضي بياخد الباقي بعد الكاش", async ({ page, env }) => {
  await users(env);
  const b = await env.seedBooking({ room: 615, guest: "Two Ways", start: 0, nights: 2, price: 500, paid: 0, currency: "EGP", anchor: "shift" });
  await page.goto("/");
  await login(page, "ahmed");
  await claimShift(page);
  await goTab(page, "لوحة الغرف");
  await openRoom(page, 615);
  const panel = page.getByTestId("pay-panel");
  await panel.getByTestId("collect-method").selectOption("فيزا");
  await panel.getByTestId("pay-last4").fill("1234");
  await panel.getByTestId("pay-more-add").click();
  await panel.getByTestId("pay-more-amount-0").fill("400");             // 400 كاش، والفيزا بتاخد الباقي (600)
  await panel.getByTestId("pay-record").click();
  await expect(toast(page)).toContainText("الحجز مدفوع بالكامل");
  expect(Number((await booking(env, b)).amount_paid)).toBe(1000);
  const rows = await env.q("select r->>'collectionMethod' m, calma_num(r->>'collectionAmt')::float amt from shift_records s, jsonb_array_elements(s.rows) r where r->>'bookingId' = $1 and calma_num(r->>'collectionAmt') > 0 order by 2", [b]);
  expect(rows.map((r) => `${r.amt} ${r.m}`)).toEqual(["400 كاش", "600 فيزا"]);
});

test("تمديد بعملة تانية: الليالي الجديدة بتتسجّل حجز تكملة بالجنيه (سعر الليلة بعملة واحدة) وبتتدفع بيها", async ({ page, env }) => {
  await users(env);
  const b = await env.seedBooking({ room: 616, guest: "Dollar Guest", start: -1, nights: 2, price: 40, paid: 80, currency: "USD", anchor: "shift" });
  await env.q("update bookings set guest_codes = '[\"DG1\"]'::jsonb, status = 'تم تسجيل الدخول' where id = $1", [b]);
  await page.goto("/");
  await login(page, "ahmed");
  await claimShift(page);
  await goTab(page, "لوحة الغرف");
  await openRoom(page, 616);
  await page.getByTestId("extend-currency").selectOption("EGP");
  await page.getByTestId("extend-price").fill("1900");
  await page.getByTestId("extend-pay-add").click();
  await page.getByTestId("extend-pay-amount-0").fill("1900");
  await page.getByTestId("extend-go").click();
  await expect(toast(page)).toContainText("حجز تكملة");
  const orig = (await env.q("select checkout::text, currency, total_room::float from bookings where id = $1", [b]))[0];
  expect(orig).toEqual({ checkout: cairoDate(1), currency: "USD", total_room: 80 });            // الحجز الأصلي زي ما هو
  const cont = (await env.q("select checkin::text, checkout::text, currency, total_room::float, amount_paid::float from bookings where guest_name = 'Dollar Guest' and id <> $1", [b]))[0];
  expect(cont).toEqual({ checkin: cairoDate(1), checkout: cairoDate(2), currency: "EGP", total_room: 1900, amount_paid: 1900 });
  // مربوطة بالأصل وأخدت أكواده، وحالتها "مؤكد" لحد ما يومها ييجي
  const link = (await env.q("select continues_from, guest_codes, status from bookings where guest_name = 'Dollar Guest' and id <> $1", [b]))[0];
  expect(link).toEqual({ continues_from: b, guest_codes: ["DG1"], status: "مؤكد" });
  // يومها جه: الحالة بتتظبط لوحدها مع التحميل
  await env.q("update bookings set checkout = $2 where id = $1", [b, cairoDate(0)]);
  await env.q("update bookings set checkin = $2 where continues_from = $1", [b, cairoDate(0)]);
  await page.reload();
  await expect.poll(async () => (await env.q("select status from bookings where continues_from = $1", [b]))[0].status).toBe("تم تسجيل الدخول");
});

test("الحجوزات: الشاشة بتحمّل آخر ٣ شهور، والحجز القديم بيظهر بالبحث", async ({ page, env }) => {
  await users(env);
  await env.seedBooking({ room: 601, guest: "Ancient Guest", start: -200, nights: 2, price: 100, paid: 0, currency: "EGP" });
  await env.seedBooking({ room: 602, guest: "Recent Guest", start: -10, nights: 2, price: 100, paid: 0, currency: "EGP" });
  await page.goto("/");
  await login(page, "boss");
  await goTab(page, "الحجوزات");
  await expect(page.getByText("Recent Guest").first()).toBeVisible();
  await expect(page.getByText("Ancient Guest")).toHaveCount(0);
  await page.getByLabel("بحث في الحجوزات").fill("Ancient");
  await expect(page.getByText("Ancient Guest").first()).toBeVisible();
});

test("مدير الشيفت بيعدّل ويمسح الكافيتيريا: استهلاك الاستاف وتحصيل الكافيتيريا (المبلغ والوسيلة)", async ({ page, env }) => {
  await users(env);
  await page.goto("/");
  await login(page, "mona");
  await claimShift(page);
  await page.getByTestId("staff-cafe-who").selectOption("sara");
  await page.getByTestId("staff-cafe-amount").fill("40");
  await page.getByTestId("staff-cafe-paymode").selectOption("كاش");
  await page.getByTestId("staff-cafe-add").click();
  await expect(toast(page)).toContainText("السداد");
  // تعديل تحصيل الكافيتيريا: 40 كاش ← 35 فيزا
  await page.getByTestId("cafeteria-row").first().getByTestId("cafe-row-edit").click();
  await page.getByTestId("cafe-row-amount").fill("35");
  await page.getByTestId("cafeteria-row").first().locator("select").first().selectOption("فيزا");
  await page.getByTestId("cafe-row-save").click();
  await expect(toast(page)).toContainText("تم تعديل تحصيل الكافيتيريا");
  const row = (await env.q("select cafeteria_rows from shift_records"))[0].cafeteria_rows[0];
  expect([Number(row.collectionAmt), row.collectionMethod]).toEqual([35, "فيزا"]);
  // تعديل الاستهلاك نفسه (المبلغ)
  await page.getByTestId("staff-cafe-entry").first().getByTestId("staff-cafe-fix").click();
  await page.getByTestId("staff-cafe-fix-amount").fill("45");
  await page.getByTestId("staff-cafe-fix-save").click();
  await expect(toast(page)).toContainText("تم تعديل الاستهلاك");
  expect(Number((await env.q("select amount from staff_cafeteria"))[0].amount)).toBe(45);
  // مسح تحصيل الكافيتيريا
  await page.getByTestId("cafeteria-row").first().getByTestId("cafe-row-edit").click();
  await page.getByTestId("cafe-row-delete").click();
  await expect(toast(page)).toContainText("اتمسح تحصيل الكافيتيريا");
  await expect(page.getByTestId("cafeteria-row")).toHaveCount(0);
});
