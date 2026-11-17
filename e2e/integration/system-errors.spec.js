// سجل أخطاء السيستم: خطأ غير متوقع عند موظف بيتسجّل لوحده، والمدير العام بيشوفه في سجل الحركة، والموظف مايقراش السجل.
import { test, expect } from "../fixtures";
import { login, goTab, logout, shiftDay, myShiftKey } from "../ui";

test("خطأ غير متوقع في متصفح الموظف بيتسجّل، والمدير العام بيشوفه في سجل الحركة", async ({ page, env }) => {
  await env.seedUser("boss", "gm", "المدير");
  await env.seedUser("ahmed", "staff", "أحمد");
  await page.goto("/");
  await login(page, "ahmed");
  await page.evaluate(() => { setTimeout(() => { throw new Error("boom-e2e-test"); }, 0); });
  await expect.poll(async () => (await env.q("select username, kind, message from client_errors")).map((r) => `${r.username}|${r.kind}|${r.message}`), { timeout: 10_000 })
    .toContain("ahmed|js|Uncaught Error: boom-e2e-test");
  // رسايل قواعد السيستم العادية (P0001) مش أخطاء ومابتتسجّلش
  const before = (await env.q("select count(*)::int n from client_errors"))[0].n;
  await env.api("ahmed", "POST", "/rest/v1/rpc/record_booking_payment", { p_booking: "00000000-0000-0000-0000-000000000000", p_amount: 5, p_method: "كاش", p_details: {}, p_note: "", p_expected: null });
  expect((await env.q("select count(*)::int n from client_errors"))[0].n).toBe(before);
  // الموظف مايقدرش يقرا سجل الأخطاء
  const r = await env.api("ahmed", "GET", "/rest/v1/client_errors?select=id");
  expect(Array.isArray(r.body) ? r.body.length : 0).toBe(0);
  await logout(page);
  await login(page, "boss");
  await goTab(page, "سجل الحركة");
  const box = page.getByTestId("system-errors");
  await expect(box).toContainText("1 في آخر ٢٤ ساعة");
  await box.locator("summary").first().click();
  await expect(box.getByTestId("system-error-row").first()).toContainText("boom-e2e-test");
});

test("الدفعة المسجّلة على حجز في اليومية ماتتعدّلش بالإيد: الخانة مقفولة في الشاشة، والتعديل المباشر بيترفض من القاعدة", async ({ page, env }) => {
  await env.seedUser("ahmed", "staff", "أحمد");
  const b = await env.seedBooking({ room: 603, guest: "Linked Guest", start: 0, nights: 2, price: 500, paid: 0, currency: "EGP", anchor: "shift" });
  await env.seedShift("ahmed", {});
  const pay = await env.api("ahmed", "POST", "/rest/v1/rpc/record_booking_payment", { p_booking: b, p_amount: 800, p_method: "كاش", p_details: {}, p_note: "تحصيل", p_expected: null });
  expect(pay.status, JSON.stringify(pay.body)).toBeLessThan(300);
  // تعديل مباشر لمبلغ الدفعة المربوطة (زي اللي كان بيحصل من الشاشة) بيترفض والحجز واليومية فاضلين متطابقين
  const rec = (await env.q("select rows from shift_records"))[0];
  const tampered = rec.rows.map((r) => (r.bookingId === b ? { ...r, collectionAmt: "" } : r));
  const bad = await env.api("ahmed", "PATCH", `/rest/v1/shift_records?date=eq.${shiftDay()}&shift_key=eq.${myShiftKey()}`, { rows: tampered });
  expect(bad.status).toBeGreaterThanOrEqual(400);
  expect(JSON.stringify(bad.body)).toContain("ماتتعدّلش بالإيد");
  expect(Number((await env.q("select rows from shift_records"))[0].rows.find((r) => r.bookingId === b).collectionAmt)).toBe(800);
  // صف غرفة تانية (مش مربوط بحجز) بيتعدّل عادي
  const ok = await env.api("ahmed", "PATCH", `/rest/v1/shift_records?date=eq.${shiftDay()}&shift_key=eq.${myShiftKey()}`, { rows: rec.rows.map((r) => (r.room === 605 && !r.bookingId ? { ...r, collectionAmt: 50, collectionDesc: "تحصيل يدوي" } : r)) });
  expect(ok.status, JSON.stringify(ok.body)).toBeLessThan(300);
  // في الشاشة: خانات الدفعة المربوطة مقفولة ومعاها توضيح
  await page.goto("/");
  await login(page, "ahmed");
  await goTab(page, "اليومية");
  const row = page.locator("tr[data-linked='true']", { hasText: "603" }).first();
  await expect(row.getByTestId("ledger-linked-note")).toBeVisible();
  await expect(row.locator("input[type='number']").first()).toBeDisabled();
  // المطوّر: كل الصلاحيات - الصف المربوط مفتوح له في الشاشة والقاعدة
  await env.seedUser("devo", "dev", "المطوّر");
  await logout(page);
  await login(page, "devo");
  await goTab(page, "اليومية");
  await expect(page.locator("tr[data-linked='true']")).toHaveCount(0);
  const devRow = page.locator("tr", { hasText: "Linked Guest" }).first();
  await expect(devRow.locator("input[type='number']").first()).toBeEnabled();
  await expect(devRow.getByTestId("ledger-linked-note")).toHaveCount(0);
  const rec2 = (await env.q("select rows from shift_records"))[0];
  const devFix = await env.api("devo", "PATCH", `/rest/v1/shift_records?date=eq.${shiftDay()}&shift_key=eq.${myShiftKey()}`, { rows: rec2.rows.map((r) => (r.bookingId === b ? { ...r, collectionDesc: "تعديل المطوّر" } : r)) });
  expect(devFix.status, JSON.stringify(devFix.body)).toBeLessThan(300);
  expect((await env.q("select rows from shift_records"))[0].rows.find((r) => r.bookingId === b).collectionDesc).toBe("تعديل المطوّر");
});
