/*
  الرد من ناحية الريسيبشن (مدير الحجوزات) + تسجيل عربون على حجز بعيد من موظف الشيفت.
  اللي اتصلّح بعد مراجعة مسار الرد: وسيلة الرد الافتراضية من اللي اتدفع فعلًا، تحذير لو الوسيلة مادفعش بيها، رفض الرد بتأكيد،
  رسالة الرد بتقول التوزيع، وعربون على حجز أكتر من يومين قدام.
*/
import { test, expect } from "../fixtures";
import { login, logout, goTab, toast, digits, openMore, field } from "../ui";

async function users(env) {
  await env.seedUser("boss", "gm", "المدير");
  await env.seedUser("ahmed", "staff", "أحمد");
  await env.seedUser("rawan", "reservations", "روان");
}
const rowFor = (room, id, amt, method, details) => ({ bookingId: id, collectionAmt: amt, collectionMethod: method, collectionCurrency: "USD", collectionDesc: "تحصيل سابق", paymentDetails: { senderName: "", senderNumber: details || "", ref: "", onlinePaid: false } });
const card = (page, guest) => page.locator(".cx-card", { hasText: guest }).last();

test("الرد: الوسيلة الافتراضية اللي اتدفع بيها، تحذير لو اخترت وسيلة تانية، والتوزيع بيتقال في الرسالة", async ({ page, env }) => {
  await users(env);
  const visa = await env.seedBooking({ room: 604, guest: "Visa Guest", nights: 2, price: 100, paid: 200, method: "كاش", status: "ملغي" });
  const cash = await env.seedBooking({ room: 605, guest: "Cash Guest", nights: 2, price: 100, paid: 200, method: "فيزا", status: "ملغي" });
  await env.qRaw("update bookings set refund_pending = true where status = 'ملغي'");
  // وسيلة آخر دفعة على الحجز (payment_method) مختلفة عن اللي اتدفع بيه فعلًا في اليومية: الافتراضي لازم يتبع اليومية
  await env.seedShift("ahmed", { rowsPatch: { 604: rowFor(604, visa, 200, "فيزا", "4242"), 605: rowFor(605, cash, 200, "كاش") } });
  await page.goto("/"); await login(page, "rawan");
  await goTab(page, "الحجوزات");
  await page.getByTestId("status-filter-all").click();

  const vReq = card(page, "Visa Guest").getByTestId("refund-request");
  const cReq = card(page, "Cash Guest").getByTestId("refund-request");
  await expect(vReq.getByTestId("refund-paid-breakdown")).toContainText("فيزا");
  await expect(vReq.getByTestId("refund-paid-breakdown")).toContainText("4242");
  await expect(vReq.locator("select")).toHaveValue("فيزا");        // مش "كاش" (آخر وسيلة على الحجز)
  await expect(cReq.locator("select")).toHaveValue("كاش");         // ومش "فيزا"
  await expect(vReq.getByTestId("refund-no-balance-warning")).toHaveCount(0);

  // وسيلة النزيل مادفعش بيها: تحذير واضح
  await vReq.locator("select").selectOption("فودافون كاش");
  await expect(vReq.getByTestId("refund-no-balance-warning")).toContainText("ماتدفعش");
  await vReq.locator("select").selectOption("فيزا");
  await expect(vReq.getByTestId("refund-no-balance-warning")).toHaveCount(0);

  // الرد: الرسالة بتقول الوسيلة وآخر ٤ أرقام، واليومية اتخصمت من الفيزا بالكارت
  await vReq.getByTestId("refund-approve").click();
  await expect(toast(page)).toContainText("فيزا");
  await expect(toast(page)).toContainText("4242");
  const [rec] = await env.q("select rows from shift_records");
  const mine = rec.rows.filter((r) => r.bookingId === visa);
  expect(mine.reduce((a, r) => a + Number(r.collectionAmt), 0)).toBe(0);
  expect(mine.some((r) => r.collectionMethod === "فيزا")).toBe(true);
  expect(mine.some((r) => r.collectionMethod === "كاش" && Number(r.collectionAmt) !== 0)).toBe(false);   // الكاش ماتلمسش
});

test("رفض الرد بيحتاج تأكيد (مفيش رجوع بعده)", async ({ page, env }) => {
  await users(env);
  const id = await env.seedBooking({ room: 606, guest: "Reject Guest", nights: 1, price: 100, paid: 100, method: "كاش", status: "ملغي" });
  await env.qRaw("update bookings set refund_pending = true where status = 'ملغي'");
  await env.seedShift("ahmed", { rowsPatch: { 606: rowFor(606, id, 100, "كاش") } });
  await page.goto("/"); await login(page, "rawan");
  await goTab(page, "الحجوزات");
  await page.getByTestId("status-filter-all").click();
  const req = card(page, "Reject Guest").getByTestId("refund-request");
  await req.getByTestId("refund-reject").click();
  // أول ضغطة مابتقرّرش حاجة
  await expect(req.getByTestId("refund-reject-confirm")).toBeVisible();
  let [b] = await env.q("select refund_pending from bookings where id = $1", [id]);
  expect(b.refund_pending).toBe(true);
  // إلغاء الرفض بيرجّع الأزرار
  await req.getByRole("button", { name: "إلغاء" }).click();
  await expect(req.getByTestId("refund-approve")).toBeVisible();
  await req.getByTestId("refund-reject").click();
  await req.getByTestId("refund-reject-confirm").click();
  await expect(toast(page)).toContainText("تم رفض الرد");
  [b] = await env.q("select refund_pending, refund_decision from bookings where id = $1", [id]);
  expect(b).toEqual({ refund_pending: false, refund_decision: "kept" });
});

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
  // فيزا من غير ٤ أرقام: مرفوض
  await c.getByTestId("quickpay-amount").fill("50");
  await c.getByTestId("quickpay-method").selectOption("فيزا");
  await c.getByTestId("quickpay-submit").click();
  await expect(toast(page)).toContainText("آخر ٤ أرقام");
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
