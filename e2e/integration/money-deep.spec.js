/*
  سيناريوهات مالية عميقة (فوق قاعدة بيانات حقيقية): إقفال الشيفت وتفاصيل الفيزا، عملات، رد الفلوس بالفيزا،
  حجز أونلاين بخدمات، مديونية استاف عبر شيفتات، قفل الشيفت، ودوسة مزدوجة.
*/
import { test, expect } from "../fixtures";
import { login, logout, claimShift, addBooking, goTab, roomCard, toast, digits, cairoDate, openRoom, payOnBoard, showAllRooms, waitIdle, refresh, shiftDay, myShiftKey } from "../ui";

async function users(env) {
  await env.seedUser("boss", "gm", "المدير");
  await env.seedUser("ahmed", "staff", "أحمد");
  await env.seedUser("sara", "staff", "سارة");
  await env.seedUser("rawan", "reservations", "روان");
  await env.seedUser("mona", "accounts", "منى");
}
const booking = async (env, guest) => (await env.q("select * from bookings where guest_name = $1", [guest]))[0];
const shift = async (env) => (await env.q("select * from shift_records"))[0];
const nonZero = (rows) => rows.filter((r) => Number(r.collectionAmt) !== 0);
const lrow = (page, n) => page.locator("table.cx-table tbody tr", { hasText: String(n) }).first();

test("إقفال الشيفت مرفوض لو فيه تحصيل فيزا من غير آخر ٤ أرقام (أو تحويل من غير رقم)، وبعد ما تتكتب بيتقفل", async ({ page, env }) => {
  await users(env);
  await page.goto("/"); await login(page, "ahmed"); await claimShift(page); await showAllRooms(page);
  // صف يدوي: فيزا ١٠٠ دولار من غير تفاصيل
  const r = lrow(page, 602);
  await r.locator("select.cx-select").nth(2).selectOption("فيزا");
  await r.getByPlaceholder("المبلغ").nth(1).fill("100");
  await r.locator("select.cx-select").nth(3).selectOption("USD");
  await page.getByRole("button", { name: /إقفال الشيفت/ }).click();
  await expect(toast(page)).toContainText("مينفعش تقفل الشيفت");
  await expect(toast(page)).toContainText("آخر ٤ أرقام");
  await expect.poll(async () => (await shift(env)).closed, { timeout: 5000 }).toBe(false);
  // تحويل من غير رقم برضه مرفوض
  await r.locator("select.cx-select").nth(2).selectOption("فودافون كاش");
  await page.getByRole("button", { name: /إقفال الشيفت/ }).click();
  await expect(toast(page)).toContainText("رقم التليفون");
  // نرجع فيزا ونكتب آخر ٤ أرقام: الإقفال بيعدّي
  await r.locator("select.cx-select").nth(2).selectOption("فيزا");
  await r.locator('input[placeholder="آخر ٤ أرقام الكارت"]').fill("6789");
  await page.getByRole("button", { name: /إقفال الشيفت/ }).click();
  await expect(page.getByText(/أُقفل بواسطة/)).toBeVisible();
  const rec = await shift(env);
  expect(rec.closed).toBe(true);
  expect(rec.by_method_currency["فيزا"]).toEqual({ USD: 100 });
  expect(nonZero(rec.rows)[0].paymentDetails.senderNumber).toBe("6789");
  expect(rec.method_closing["فيزا"]).toEqual({ USD: 100 });
});

test("عملة تانية (يورو): الفيزا تتسجّل باليورو، والتقرير بيعرضها في عمود اليورو، والكاش لسه صفر", async ({ page, env }) => {
  await users(env);
  await env.seedShift("ahmed");
  await env.seedBooking({ room: 603, guest: "Euro Visa", nights: 2, price: 80, currency: "EUR" });
  await page.goto("/"); await login(page, "ahmed");
  await goTab(page, "لوحة الغرف"); await openRoom(page, 603);
  await payOnBoard(page, { method: "فيزا", last4: "0101" });
  await expect(toast(page)).toContainText("الحجز مدفوع بالكامل");
  const rec = await shift(env);
  expect(nonZero(rec.rows)).toEqual([expect.objectContaining({ collectionAmt: 160, collectionMethod: "فيزا", collectionCurrency: "EUR" })]);
  await logout(page); await login(page, "mona");
  await goTab(page, "التقارير");
  const visa = page.locator("table.cx-table tr", { hasText: "فيزا" }).first();
  expect(digits(await visa.innerText())).toContain("160");
  expect(digits(await page.getByTestId("report-noncash-tx").innerText())).toContain("160EUR");
  expect(digits(await page.locator(".cx-report-grid .cx-card", { hasText: "إجمالي التحصيل" }).first().innerText())).toContain("160");
});

test("حجز أونلاين: خدمات اتحصّلت بالفيزا بتروح لصف فيزا، وسعر الغرفة ماتتحسبش (اتدفع للمنصة)", async ({ page, env }) => {
  await users(env);
  await env.seedShift("ahmed");
  await env.seedBooking({ room: 604, guest: "Platform", nights: 2, price: 100, source: "Booking.com", payment_details: { senderName: "", senderNumber: "", ref: "BK-9", onlinePaid: true }, extras: { laundry: 0, cafeteria: 30, tours: 20, pickup: 0 } });
  await page.goto("/"); await login(page, "ahmed");
  await goTab(page, "لوحة الغرف"); await openRoom(page, 604);
  expect(digits(await roomCard(page).getByTestId("money-box").innerText())).toContain("50");    // المتبقي على الفندق = الخدمات بس
  await payOnBoard(page, { amount: 30, method: "فيزا", last4: "3030" });
  await expect(toast(page)).toContainText("المتبقي");
  await payOnBoard(page, { method: "كاش" });
  await expect(toast(page)).toContainText("الحجز مدفوع بالكامل");
  const b = await booking(env, "Platform");
  expect(Number(b.amount_paid)).toBe(50);
  expect(b.settled).toBe(true);
  const rec = await shift(env);
  // ٣٠ فيزا = كافيتيريا النزيل بالكامل (بتتسدّد الأول) في صف الكافيتيريا، و٢٠ كاش جولات في صف الغرفة
  expect(rec.cafeteria_rows).toEqual([expect.objectContaining({ kind: "guest", collectionAmt: 30, collectionMethod: "فيزا" })]);
  expect(nonZero(rec.rows)).toEqual([expect.objectContaining({ collectionAmt: 20, collectionMethod: "كاش" })]);
});

test("إلغاء حجز مدفوع بالفيزا: طلب رد، ومدير الحجوزات يرد بالفيزا فيتخصم من صف الفيزا وبيرجّع الصفر (من غير ما يلمس الكاش)", async ({ page, env }) => {
  await users(env);
  await env.seedShift("ahmed");
  await env.seedBooking({ room: 605, guest: "Cancel Visa", nights: 1, price: 100 });
  await page.goto("/"); await login(page, "ahmed");
  await goTab(page, "لوحة الغرف"); await openRoom(page, 605);
  await payOnBoard(page, { method: "فيزا", last4: "5050" });
  await expect(toast(page)).toContainText("الحجز مدفوع بالكامل");
  const res = await env.newSession();
  await res.goto("/"); await login(res, "rawan");
  await goTab(res, "الحجوزات");
  await res.getByTestId("status-filter-all").click();
  const card = res.locator(".cx-card", { hasText: "Cancel Visa" }).last();
  await card.getByRole("button", { name: "إلغاء الحجز" }).click();
  await card.getByRole("button", { name: "تأكيد الإلغاء؟" }).click();
  await expect(toast(res)).toContainText("تم إلغاء الحجز");
  const req = res.locator(".cx-card", { hasText: "Cancel Visa" }).last().getByTestId("refund-request");
  await req.locator("select").selectOption("فيزا");
  await req.getByRole("button", { name: "رد الفلوس" }).click();
  await expect(toast(res)).toContainText("تم رد");
  const b = await booking(env, "Cancel Visa");
  expect(Number(b.amount_paid)).toBe(0);
  expect(b.refund_decision).toBe("refunded");
  expect(b.settled).toBe(false);                      // ملغي = مش متحصّل
  const rec = await shift(env);
  const rows = rec.rows.filter((r) => r.room === 605);
  expect(rows.filter((r) => r.collectionMethod === "كاش" && Number(r.collectionAmt) !== 0)).toHaveLength(0);
  expect(rows.reduce((s, r) => s + Number(r.collectionAmt || 0), 0)).toBe(0);
  expect(rows.find((r) => r.collectionMethod === "فيزا").paymentDetails.senderNumber).toBe("5050");   // نفس الصف/نفس الكارت
});

test("مديونية استاف من يوم قبل: الموظف النهارده يسدّد، بيتسجّل في يوميته، والمديونية بتتقفل", async ({ page, env }) => {
  await users(env);
  await env.seedShift("ahmed");
  await env.q(`insert into staff_cafeteria(day, shift_key, consumer_username, consumer_name, description, amount, currency, recorded_by)
               values ($1, 'evening', 'sara', 'سارة', 'قديمة', 80, 'EGP', 'old')`, [cairoDate(-3)]);
  await page.goto("/"); await login(page, "ahmed");
  await goTab(page, "اليومية");
  const bal = page.getByTestId("staff-cafe-balance");
  await expect(bal).toContainText("سارة");
  await bal.getByTestId("staff-cafe-settle-open").click();
  await page.getByTestId("staff-cafe-pay-amount").fill("30");
  await page.getByTestId("staff-cafe-pay-go").click();
  await waitIdle(page);
  expect(Number((await env.q("select paid_amount from staff_cafeteria"))[0].paid_amount)).toBe(30);
  await expect.poll(async () => digits(await page.getByTestId("staff-cafe-balance").innerText())).toContain("50EGP");
  await page.getByTestId("staff-cafe-balance").getByTestId("staff-cafe-settle-open").click();
  await page.getByTestId("staff-cafe-pay-go").click();
  await waitIdle(page);
  await expect(page.getByTestId("staff-cafe-balance")).toHaveCount(0);
  const rec = await shift(env);
  expect(rec.cafeteria_rows).toEqual([expect.objectContaining({ kind: "staff", who: "سارة", collectionAmt: 80, collectionMethod: "كاش" })]);
  expect(Number((await env.q("select paid_amount from staff_cafeteria"))[0].paid_amount)).toBe(80);
});

test("قفل الشيفت بيقفل تسجيل كافيتيريا الاستاف، وإعادة الفتح بترجّعه", async ({ page, env }) => {
  await users(env);
  await page.goto("/"); await login(page, "ahmed"); await claimShift(page);
  await expect(page.getByTestId("staff-cafe-form")).toBeVisible();
  await page.getByRole("button", { name: /إقفال الشيفت/ }).click();
  await expect(page.getByText(/أُقفل بواسطة/)).toBeVisible();
  await expect(page.getByTestId("staff-cafe-form")).toHaveCount(0);
  await logout(page); await login(page, "rawan");
  await goTab(page, "اليومية");
  await page.getByRole("button", { name: /استعراض شيفتات سابقة/ }).click();
  await page.getByRole("button", { name: /إعادة فتح الشيفت/ }).click();
  await expect(toast(page)).toContainText("تم إعادة فتح الشيفت");
  await logout(page); await login(page, "ahmed");
  await goTab(page, "اليومية");
  await expect(page.getByTestId("staff-cafe-form")).toBeVisible();
});

test("دوسة مزدوجة سريعة على 'تسجيل التحصيل' ماتسجّلش المبلغ مرتين", async ({ page, env }) => {
  await users(env);
  await env.seedShift("ahmed");
  await env.seedBooking({ room: 606, guest: "Double Click", nights: 1, price: 200 });
  await page.goto("/"); await login(page, "ahmed");
  await goTab(page, "لوحة الغرف"); await openRoom(page, 606);
  await page.getByTestId("pay-amount").fill("80");
  await page.getByTestId("pay-record").dblclick();
  await waitIdle(page);
  expect(Number((await booking(env, "Double Click")).amount_paid)).toBe(80);
  expect(nonZero((await shift(env)).rows).reduce((s, r) => s + Number(r.collectionAmt), 0)).toBe(80);
});

test("كل الأدوار بتشوف حالة الدفع (مدفوع بالكامل / دفع جزئي / لسه مدفعش) في قايمة الحجوزات من غير أي علامة", async ({ page, env }) => {
  await users(env);
  await env.seedBooking({ room: 601, guest: "Full", nights: 1, price: 100, paid: 100 });
  await env.seedBooking({ room: 602, guest: "Part", nights: 1, price: 100, paid: 40 });
  await env.seedBooking({ room: 603, guest: "None", nights: 1, price: 100 });
  for (const u of ["mona", "boss", "rawan"]) {
    await page.goto("/"); await login(page, u);
    await goTab(page, "الحجوزات");
    const st = async (g) => (await page.locator(".cx-card", { hasText: g }).last().getByTestId("pay-state").innerText()).trim();
    expect(await st("Full")).toBe("مدفوع بالكامل");
    expect(await st("Part")).toBe("دفع جزئي");
    expect(await st("None")).toBe("لسه مدفعش");
    await logout(page);
  }
});

/* رد الفلوس بيتقسّم على وسائل الدفع الأصلية (فيزا ١٠٠ بكارت + كاش ٥٠) */
async function paidVisaAndCash(page, env, guest, room) {
  await env.seedShift("ahmed");
  await env.seedBooking({ room, guest, nights: 1, price: 150 });
  await page.goto("/"); await login(page, "ahmed");
  await goTab(page, "لوحة الغرف"); await openRoom(page, room);
  await payOnBoard(page, { amount: 100, method: "فيزا", last4: "1111" });
  await expect.poll(async () => Number((await booking(env, guest)).amount_paid), { timeout: 8000 }).toBe(100);
  await payOnBoard(page, { amount: 50, method: "كاش" });
  await expect.poll(async () => Number((await booking(env, guest)).amount_paid), { timeout: 8000 }).toBe(150);
}
async function cancelAndRefund(env, guest, method) {
  const res = await env.newSession();
  await res.goto("/"); await login(res, "rawan");
  await goTab(res, "الحجوزات");
  await res.getByTestId("status-filter-all").click();
  const card = res.locator(".cx-card", { hasText: guest }).last();
  await card.getByRole("button", { name: "إلغاء الحجز" }).click();
  await card.getByRole("button", { name: "تأكيد الإلغاء؟" }).click();
  await expect(toast(res)).toContainText("تم إلغاء الحجز");
  const req = res.locator(".cx-card", { hasText: guest }).last().getByTestId("refund-request");
  await req.locator("select").selectOption(method);
  await req.getByRole("button", { name: "رد الفلوس" }).click();
  await expect(toast(res)).toContainText("تم رد");
}
const net = (rows, m, num) => rows.filter((r) => r.collectionMethod === m && (num === undefined || r.paymentDetails?.senderNumber === num)).reduce((s, r) => s + Number(r.collectionAmt || 0), 0);

test("رد فلوس حجز دافع فيزا ١٠٠ + كاش ٥٠ بالفيزا: الفيزا بترجع ١٠٠ على نفس الكارت والكاش ٥٠ (مفيش وسيلة بتنزل سالب)", async ({ page, env }) => {
  await users(env);
  await paidVisaAndCash(page, env, "Split Refund", 607);
  await cancelAndRefund(env, "Split Refund", "فيزا");
  const rows = (await shift(env)).rows.filter((r) => r.room === 607);
  expect(net(rows, "فيزا", "1111")).toBe(0);
  expect(net(rows, "كاش")).toBe(0);
  expect(rows.reduce((s, r) => s + Number(r.collectionAmt || 0), 0)).toBe(0);
  expect(rows.every((r) => Number(r.collectionAmt) === 0 || Number(r.collectionAmt) > 0)).toBe(true);
  const b = await booking(env, "Split Refund");
  expect(Number(b.amount_paid)).toBe(0);
  expect(Number(b.refunded_amount)).toBe(150);
});

test("نفس الحالة بالكاش: الكاش ٥٠ الأول ثم الفيزا ١٠٠ (ومفيش رصيد سالب في أي وسيلة)", async ({ page, env }) => {
  await users(env);
  await paidVisaAndCash(page, env, "Split Refund Cash", 608);
  await cancelAndRefund(env, "Split Refund Cash", "كاش");
  const rows = (await shift(env)).rows.filter((r) => r.room === 608);
  expect(net(rows, "كاش")).toBe(0);
  expect(net(rows, "فيزا", "1111")).toBe(0);
});

test("رد بوسيلة ماتدفعش بيها (دفع كاش والرد بتحويل): قرار المدير بيمشي والرد كله على التحويل", async ({ page, env }) => {
  await users(env);
  await env.seedShift("ahmed");
  await env.seedBooking({ room: 609, guest: "Cash Then Transfer", nights: 1, price: 100 });
  await page.goto("/"); await login(page, "ahmed");
  await goTab(page, "لوحة الغرف"); await openRoom(page, 609);
  await payOnBoard(page, { method: "كاش" });
  await expect.poll(async () => Number((await booking(env, "Cash Then Transfer")).amount_paid), { timeout: 8000 }).toBe(100);
  await cancelAndRefund(env, "Cash Then Transfer", "تحويل بنكي / انستاباي");
  const rows = (await shift(env)).rows.filter((r) => r.room === 609);
  expect(net(rows, "كاش")).toBe(100);
  expect(net(rows, "تحويل بنكي / انستاباي")).toBe(-100);
});
