import { test, expect, say, pause, users, login, logout, claimShift, goTab, toast, openRoom, payOnBoard, waitIdle, cairoDate, addBooking, digits } from "./helpers";

test("06 - التقارير (يوم / فترة / نسخ الملخص)، الموبايل، ومعاينة الطباعة", async ({ page, env }) => {
  await users(env);
  await env.seedBooking({ room: 601, guest: "حجز التقرير ١", nights: 2, price: 100 });
  await env.seedBooking({ room: 602, guest: "حجز أونلاين", nights: 2, price: 150, source: "Booking.com", payment_details: { senderName: "", senderNumber: "", ref: "BK-1", onlinePaid: true } });
  await page.goto("/");
  await login(page, "ahmed"); await claimShift(page);
  await goTab(page, "لوحة الغرف");
  await openRoom(page, 601);
  await payOnBoard(page, { amount: 120, method: "فيزا", last4: "4242" });
  await payOnBoard(page, { amount: 30, method: "فودافون كاش", senderName: "منى", phone: "01099990000" });
  await payOnBoard(page, { amount: 50, method: "كاش" });
  await goTab(page, "اليومية");
  await page.getByTestId("staff-cafe-who").selectOption("sara");
  await page.getByTestId("staff-cafe-amount").fill("30"); await page.getByTestId("staff-cafe-add").click(); await waitIdle(page);
  await logout(page);

  await say(page, "١) تقرير اليوم: الشيفتات + إجمالي التحصيل/المصاريف/الصافي + الإشغال", 2000);
  await login(page, "mona"); await goTab(page, "التقارير");
  await expect(page.getByTestId("report-noncash-tx")).toBeVisible(); await pause(page, 3500);
  await say(page, "التحصيل حسب طريقة الدفع والعملة + متابعة العهدة (كاش / فيزا)", 1500);
  await page.mouse.wheel(0, 450); await pause(page, 3500);
  await say(page, "تفاصيل كل عملية فيزا/تحويل: التاريخ والشيفت والوسيلة (****4242) والجهة والمبلغ", 1500);
  await page.getByTestId("report-noncash-tx").scrollIntoViewIfNeeded(); await pause(page, 3800);
  await say(page, "الكافيتيريا: التحصيل من النزلاء / سداد الاستاف / مبيعات مباشرة + اللي عليهم فلوس", 1500);
  await page.getByTestId("report-cafeteria").scrollIntoViewIfNeeded(); await pause(page, 3500);
  await say(page, "الحجوزات الأونلاين (سعر الغرفة بس) ومبالغ متبقية على النزلاء", 1500);
  await page.mouse.wheel(0, 1200); await pause(page, 3500);
  await say(page, "نسخ الملخص: نص جاهز يتبعت واتساب", 1200);
  await page.getByRole("button", { name: /نسخ الملخص/ }).click(); await pause(page, 3200);
  await page.mouse.wheel(0, 600); await pause(page, 2500);

  await say(page, "٢) تقرير فترة (آخر ٧ أيام): بيجمع كل الأيام والشيفتات", 1500);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.getByRole("button", { name: "فترة", exact: true }).click(); await pause(page, 3000);
  await say(page, "تاريخ غلط (من بعد إلى) بيترفض برسالة", 1200);
  await page.locator('input[type="date"]').first().fill(cairoDate(5)); await pause(page, 2400);
  await page.locator('input[type="date"]').first().fill(cairoDate(-6)); await pause(page, 1800);

  await say(page, "٣) الموبايل (٣٩٠ بكسل): نفس الشاشات بتتكيّف", 1800);
  await page.setViewportSize({ width: 390, height: 844 }); await pause(page, 1800);
  await goTab(page, "لوحة الغرف"); await pause(page, 2400);
  await page.mouse.wheel(0, 600); await pause(page, 1800);
  await goTab(page, "التقارير"); await pause(page, 2400);
  await page.mouse.wheel(0, 900); await pause(page, 2400);
  await page.setViewportSize({ width: 1280, height: 800 });

  await say(page, "٤) معاينة الطباعة: ورقة رسمية بالشعار والتوقيع - من غير أزرار ولا خانات إدخال", 2000);
  await page.emulateMedia({ media: "print" }); await pause(page, 1500);
  await page.setViewportSize({ width: 900, height: 1100 }); await pause(page, 1200);
  await page.evaluate(() => window.scrollTo(0, 0)); await pause(page, 3000);
  await page.mouse.wheel(0, 900); await pause(page, 3000);
  await page.emulateMedia({ media: "screen" }); await page.setViewportSize({ width: 1280, height: 800 });
});
