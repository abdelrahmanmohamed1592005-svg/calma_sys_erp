/*
  تسجيل عربون على حجز بعيد من موظف الشيفت، وحجز خلص مايتلغيش.
  (رد الفلوس اتشال من النظام في v39 - الفلوس المتحصّلة بتفضل في الفندق)
*/
import { test, expect } from "../fixtures";
import { login, logout, goTab, toast, digits, openMore, field } from "../ui";

async function users(env) {
  await env.seedUser("boss", "gm", "المدير");
  await env.seedUser("ahmed", "staff", "أحمد");
  await env.seedUser("rawan", "reservations", "روان");
}
const card = (page, guest) => page.locator(".cx-card", { hasText: guest }).last();

test("عربون على حجز بعيد (بعد أكتر من يومين): موظف الشيفت يسجّله من قايمة الحجوزات وبيتسجّل في اليومية، ومدير الحجوزات مايشوفش الزرار", async ({ page, env }) => {
  await users(env);
  const id = await env.seedBooking({ room: 607, guest: "Far Future", start: 10, nights: 2, price: 100, total: 200 });
  await env.seedShift("ahmed");
  await page.goto("/"); await login(page, "ahmed");
  await goTab(page, "الحجوزات");
  await page.getByTestId("status-filter-all").click();
  const c = card(page, "Far Future");
  await c.getByTestId("quickpay-open").click();
  // مبلغ أكبر من المتبقي: مرفوض
  await c.getByTestId("quickpay-amount").fill("500");
  await c.getByTestId("quickpay-submit").click();
  await expect(toast(page)).toContainText("أكبر من المتبقي");
  // فيزا من غير 4 أرقام: مرفوض
  await c.getByTestId("quickpay-amount").fill("50");
  await c.getByTestId("quickpay-method").selectOption("فيزا");
  await c.getByTestId("quickpay-submit").click();
  await expect(toast(page)).toContainText("آخر 4 أرقام");
  expect(Number((await env.q("select amount_paid from bookings where id = $1", [id]))[0].amount_paid)).toBe(0);
  await c.getByTestId("quickpay-last4").fill("1234");
  await c.getByTestId("quickpay-submit").click();
  await expect(toast(page)).toContainText("تم تسجيل");
  await expect.poll(async () => Number((await env.q("select amount_paid from bookings where id = $1", [id]))[0].amount_paid), { timeout: 8000 }).toBe(50);
  const [rec] = await env.q("select rows from shift_records");
  const visaRow = rec.rows.find((r) => r.bookingId === id);
  expect(visaRow).toMatchObject({ collectionMethod: "فيزا", collectionAmt: 50 });
  expect(visaRow.paymentDetails.senderNumber).toBe("1234");
  await logout(page);
  await login(page, "rawan");
  await goTab(page, "الحجوزات");
  await page.getByTestId("status-filter-all").click();
  await expect(card(page, "Far Future").getByTestId("quickpay-open")).toHaveCount(0);
});

test("حجز ملغي بعد ما النزيل مشي (تم تسجيل الخروج): مفيش زرار إلغاء", async ({ page, env }) => {
  await users(env);
  await env.seedBooking({ room: 608, guest: "Left Already", start: -3, nights: 2, price: 100, total: 200, status: "تم تسجيل الخروج" });
  await page.goto("/"); await login(page, "rawan");
  await goTab(page, "الحجوزات");
  await page.getByTestId("status-filter-all").click();
  await expect(card(page, "Left Already")).toBeVisible();
  await expect(card(page, "Left Already").getByTestId("cancel-booking")).toHaveCount(0);
});

