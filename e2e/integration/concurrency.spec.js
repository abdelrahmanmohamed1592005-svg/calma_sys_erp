// تزامن بين جهازين/مستخدمين على نفس البيانات (فوق قاعدة حقيقية): لازم ماحدش يكتب فوق
// تعديل التاني بصمت، وماحدش ياخد الفلوس مرتين، ومحدش يحجز نفس الغرفة مرتين.
import { test, expect } from "../fixtures";
import { login, goTab, field, boardTile, roomCard, toast, claimShift, cairoDate, refresh, digits, shiftDay, myShiftKey, SHIFT_LABEL, openRoom } from "../ui";

async function users(env) {
  await env.seedUser("boss", "gm", "المدير");
  await env.seedUser("ahmed", "staff", "أحمد");
  await env.seedUser("sara", "staff", "سارة");
  await env.seedUser("rawan", "reservations", "روان");
}

test("مدير الحجوزات بيعدّل حجز والموظف حصّله في نفس اللحظة: مفيش تعديل بيضيع", async ({ page, env }) => {
  await users(env);
  const id = await env.seedBooking({ room: 601, guest: "Conflict Guest", nights: 2, price: 100 });
  await env.seedShift("ahmed");
  await page.goto("/");
  await login(page, "rawan");
  await goTab(page, "الحجوزات");
  await page.locator(".cx-card", { hasText: "Conflict Guest" }).last().locator("button").first().click();
  await field(page, "اسم النزيل").fill("Renamed By Manager");

  // في نفس الوقت الموظف على جهاز تاني بيحصّل
  const staff = await env.newSession();
  await staff.goto("/");
  await login(staff, "ahmed");
  await goTab(staff, "لوحة الغرف");
  await openRoom(staff, 601);
  await roomCard(staff).getByRole("button", { name: /تسجيل تحصيل كامل المبلغ/ }).click();
  await expect(toast(staff)).toContainText("تم تسجيل التحصيل الكامل");

  // أول حفظة: اكتشاف التعارض (من غير ما تكتب فوق التحصيل)
  await page.getByRole("button", { name: /حفظ الحجز/ }).click();
  await expect(toast(page)).toContainText(/اتحدّث|عدّل نفس الحجز/);
  let [b] = await env.q("select * from bookings where id = $1", [id]);
  expect(b).toMatchObject({ guest_name: "Conflict Guest", amount_paid: 200, settled: true });
  // بعد تحديث البيانات الحفظ يعدّي، والتحصيل لسه موجود
  const save = page.getByRole("button", { name: /حفظ الحجز/ });
  for (let i = 0; i < 4 && (await save.isVisible().catch(() => false)); i++) { await save.click(); await page.waitForTimeout(500); }
  await expect(toast(page)).toContainText("تم الحفظ");
  [b] = await env.q("select * from bookings where id = $1", [id]);
  expect(b).toMatchObject({ guest_name: "Renamed By Manager", amount_paid: 200, settled: true });
});

test("موظفين يختاروا نفس الشيفت في نفس اللحظة: واحد بس ياخده والتاني بيتنبّه", async ({ page, env }) => {
  await users(env);
  await page.goto("/");
  await login(page, "ahmed");
  const other = await env.newSession();
  await other.goto("/");
  await login(other, "sara");
  await goTab(page, "اليومية");
  await goTab(other, "اليومية");
  const btn = (p) => p.getByRole("button", { name: new RegExp(SHIFT_LABEL[myShiftKey()]) });
  await btn(page).click();
  await expect(page.getByText("شيفتك الوحيد المتاح ليك النهارده")).toBeVisible();
  await btn(other).click();      // الصفحة التانية لسه شايفة الزرار مفتوح
  await expect(toast(other)).toContainText("حد تاني اختار نفس الشيفت");
  const claims = await env.q("select username from shift_claims");
  expect(claims).toEqual([{ username: "ahmed" }]);
});

test("حجز مزدوج من جهازين: قاعدة البيانات بترفض التاني برسالة مفهومة ومفيش حجزين على نفس الغرفة", async ({ page, env }) => {
  await users(env);
  await page.goto("/");
  await login(page, "rawan");
  await goTab(page, "الحجوزات");
  await page.getByRole("button", { name: /حجز جديد/ }).click();
  await page.locator(".cx-card[data-calma-editing] select.cx-select").first().selectOption("602");
  await field(page, "اسم النزيل").fill("Second Booker");
  await field(page, "تاريخ الدخول").fill(cairoDate(3));
  await field(page, "تاريخ الخروج").fill(cairoDate(5));
  await page.locator("xpath=//label[contains(.,'السعر لليلة')]/following-sibling::div//input[@type='number']").fill("100");
  // حد تاني حجز نفس الغرفة في الوقت ده (الشاشة لسه مش شايفاه)
  await env.seedBooking({ room: 602, guest: "First Booker", start: 4, nights: 2, price: 100 });
  await page.getByRole("button", { name: /حفظ الحجز/ }).click();
  await expect(toast(page)).toContainText("الغرفة دي اتحجزت لحد تاني");
  expect(await env.q("select guest_name from bookings where room = 602")).toEqual([{ guest_name: "First Booker" }]);
});

test("قرار رد الفلوس من جهازين: بيتنفّذ مرة واحدة بس والفلوس مبتتخصمش مرتين", async ({ page, env }) => {
  await users(env);
  const id = await env.seedBooking({ room: 603, guest: "Double Refund", nights: 3, price: 100, paid: 300, settled: true, status: "ملغي" });
  await env.qRaw("update bookings set refund_pending = true where id = $1", [id]);
  await env.seedShift("ahmed", { collections: [{ room: 603, amount: 300, bookingId: id }] });
  await page.goto("/");
  await login(page, "rawan");
  await goTab(page, "الحجوزات");
  const other = await env.newSession();
  await other.goto("/");
  await login(other, "rawan");
  await goTab(other, "الحجوزات");
  const decide = async (p) => { const req = p.getByTestId("refund-request"); await req.getByRole("button", { name: "رد الفلوس" }).click(); };
  await decide(page);
  await expect(toast(page)).toContainText("تم رد");
  await decide(other);                // الجهاز التاني لسه شايف الطلب
  await expect(toast(other)).toContainText(/مفيش طلب رد|اتغيّر/);
  const [b] = await env.q("select * from bookings where id = $1", [id]);
  expect(b).toMatchObject({ amount_paid: 0, refunded_amount: 300 });
  const [rec] = await env.q("select rows from shift_records");
  expect(Number(rec.rows.find((r) => r.room === 603).collectionAmt)).toBe(0);      // ٣٠٠ - ٣٠٠ مرة واحدة (مش -٣٠٠)
});

test("الموظف بيكتب في اليومية ورد فلوس بينزل على نفس السجل: الاتنين بيتحفظوا (دمج)", async ({ page, env }) => {
  await users(env);
  const id = await env.seedBooking({ room: 604, guest: "Merge Guest", nights: 1, price: 100, paid: 100, settled: true, status: "ملغي" });
  await env.qRaw("update bookings set refund_pending = true where id = $1", [id]);
  await env.seedShift("ahmed", { collections: [{ room: 604, amount: 100, bookingId: id }] });
  await page.goto("/");
  await login(page, "ahmed");
  await goTab(page, "اليومية");
  await expect(page.locator("table.cx-table tbody tr", { hasText: "604" }).first()).toBeVisible();
  // مدير الحجوزات يرد الفلوس دلوقتي (اليومية اتغيّرت من وراء الموظف)
  const r = await env.api("rawan", "POST", "/rest/v1/rpc/decide_booking_refund", { p_booking: id, p_decision: "refund", p_expected: null, p_method: null });
  expect(r.status).toBe(200);
  // الموظف يكتب مصروف في نفس اللحظة
  const row = page.locator("table.cx-table tbody tr", { hasText: "602" }).first();
  await row.getByPlaceholder("المبلغ").nth(0).fill("25");
  await page.waitForTimeout(2200);
  const [rec] = await env.q("select * from shift_records");
  expect(Number(rec.rows.find((x) => x.room === 602).expenseAmt)).toBe(25);                 // تعديل الموظف
  expect(Number(rec.rows.find((x) => x.room === 604).collectionAmt)).toBe(0);               // رد الفلوس (١٠٠ - ١٠٠) ماضاعش
  expect(rec.booking_collections).toHaveLength(2);
});
