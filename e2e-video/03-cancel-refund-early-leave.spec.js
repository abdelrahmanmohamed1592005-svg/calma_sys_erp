import { test, expect, say, pause, users, dbBooking, login, logout, claimShift, goTab, toast, openRoom, payOnBoard, waitIdle, roomCard, field, cairoDate, digits } from "./helpers";

test("03 - الإلغاء ورد الفلوس المقسّم، المغادرة المبكرة، التسكين المكرر، وقرار 'رفض الرد'", async ({ page, env }) => {
  await users(env);
  await env.seedBooking({ room: 605, guest: "ملغي بدون فلوس", nights: 1, price: 100 });
  await env.seedBooking({ room: 606, guest: "ملغي مدفوع", nights: 1, price: 150 });
  await env.seedBooking({ room: 607, guest: "مغادرة مبكرة", nights: 3, price: 100 });
  await env.seedBooking({ room: 608, guest: "نزيل قديم", start: -2, nights: 4, price: 100 });
  await page.goto("/");
  await say(page, "١) موظف الشيفت يحصّل من أكتر من حجز (الفلوس دي هتتردّ بعدين)", 2200);
  await login(page, "ahmed"); await claimShift(page);
  await goTab(page, "لوحة الغرف");
  await openRoom(page, 606);
  await say(page, "الغرفة ٦٠٦: فيزا ١٠٠ (كارت ١١١١) + كاش ٥٠", 1200);
  await payOnBoard(page, { amount: 100, method: "فيزا", last4: "1111" }); await pause(page, 1800);
  await payOnBoard(page, { amount: 50, method: "كاش" }); await pause(page, 2000);
  await openRoom(page, 607); await payOnBoard(page, { method: "كاش" }); await pause(page, 1500);
  await openRoom(page, 608); await payOnBoard(page, { method: "كاش" }); await pause(page, 1500);

  await say(page, "٢) مغادرة مبكرة (٦٠٧): بيتحاسب على الليالي اللي قعدها بس (الحد الأدنى ليلة)", 1800);
  await openRoom(page, 607);
  await roomCard(page).getByTestId("early-leave").getByRole("button", { name: /غادر مبكرًا/ }).click(); await pause(page, 3200);
  await say(page, "الزيادة المدفوعة (٢٠٠) بتتحوّل لطلب رد فلوس لمدير الحجوزات", 1500);
  await roomCard(page).getByRole("button", { name: /تأكيد المغادرة المبكرة/ }).click(); await expect(toast(page)).toContainText("غادر مبكرًا"); await pause(page, 3200);

  await say(page, "٣) تسكين مكرر: نزيل جديد على غرفة ٦٠٨ فيها نزيل قديم دخل من يومين", 1800);
  await goTab(page, "الحجوزات");
  await page.getByRole("button", { name: /حجز جديد/ }).click();
  await page.locator(".cx-card[data-calma-editing] select.cx-select").first().selectOption("608");
  await field(page, "اسم النزيل").fill("نزيل بديل");
  await field(page, "تاريخ الخروج").fill(cairoDate(2));
  await page.locator("xpath=//label[contains(.,'السعر لليلة')]/following-sibling::div//input[@type='number']").fill("120");
  await expect(page.getByTestId("duplicate-plan")).toBeVisible(); await pause(page, 3000);
  await say(page, "الحفظ بيسجّل القديم 'غادر مبكرًا' ويتحاسب على ليلتين، والزيادة طلب رد فلوس", 1500);
  await page.getByRole("button", { name: /حفظ الحجز/ }).click(); await expect(toast(page)).toContainText("تم الحفظ"); await pause(page, 3500);
  await logout(page);

  await say(page, "٤) مدير الحجوزات (روان): بتوصلها إشعارات طلبات رد الفلوس", 1800);
  await login(page, "rawan"); await pause(page, 2800);
  await goTab(page, "الحجوزات"); await page.getByTestId("status-filter-all").click();
  await say(page, "٥) إلغاء حجز مفيهوش فلوس: مفيش رد مطلوب", 1500);
  let c = page.locator(".cx-card", { hasText: "ملغي بدون فلوس" }).last();
  await c.getByRole("button", { name: "إلغاء الحجز" }).click(); await pause(page, 1500);
  await c.getByRole("button", { name: /تأكيد الإلغاء/ }).click(); await expect(toast(page)).toContainText("تم إلغاء الحجز"); await pause(page, 2800);
  await say(page, "٦) إلغاء حجز مدفوع (فيزا ١٠٠ + كاش ٥٠): بيتفتح طلب رد فلوس", 1500);
  c = page.locator(".cx-card", { hasText: "ملغي مدفوع" }).last();
  await c.getByRole("button", { name: "إلغاء الحجز" }).click(); await pause(page, 1500);
  await c.getByRole("button", { name: /تأكيد الإلغاء/ }).click(); await expect(toast(page)).toContainText("تم إلغاء الحجز"); await pause(page, 2800);
  await say(page, "رد الفلوس بالفيزا: الفيزا بترجع ١٠٠ على نفس الكارت والكاش ٥٠ (تقسيم تلقائي)", 2200);
  const req = page.locator(".cx-card", { hasText: "ملغي مدفوع" }).last().getByTestId("refund-request");
  await req.locator("select").selectOption("فيزا"); await pause(page, 1500);
  await req.getByRole("button", { name: "رد الفلوس" }).click(); await expect(toast(page)).toContainText("تم رد"); await pause(page, 3200);
  await say(page, "٧) طلب رد المغادرة المبكرة (٢٠٠): نرفض الرد والفلوس تفضل متحصّلة", 1800);
  const req2 = page.locator(".cx-card", { hasText: "مغادرة مبكرة" }).last().getByTestId("refund-request");
  await req2.getByRole("button", { name: /رفض الرد/ }).click(); await expect(toast(page)).toContainText("تم رفض الرد"); await pause(page, 3000);
  await say(page, "٨) طلب رد النزيل القديم (التسكين المكرر): نرد كاش", 1800);
  const req3 = page.locator(".cx-card", { hasText: "نزيل قديم" }).last().getByTestId("refund-request");
  await req3.getByRole("button", { name: "رد الفلوس" }).click(); await expect(toast(page)).toContainText("تم رد"); await pause(page, 3000);
  expect(Number((await dbBooking(env, "ملغي مدفوع")).amount_paid)).toBe(0);

  await goTab(page, "اليومية");
  await say(page, "٩) اليومية: الرد اتسجّل بالسالب على وسيلة كل دفعة (فيزا ****1111 وكاش) - الصافي صفر على كل وسيلة (مفيش وسيلة نزلت تحت الصفر)", 1500);
  await page.getByRole("button", { name: /استعراض شيفتات سابقة/ }).click(); await pause(page, 3800);
  await page.mouse.wheel(0, 300); await pause(page, 3500);
  await goTab(page, "التقارير");
  await say(page, "١٠) التقرير: التحصيل الصافي بعد الردود، وطلبات الرد المعلّقة ومبالغ النزلاء المتبقية", 3500);
  await page.mouse.wheel(0, 900); await pause(page, 3000);
});
