import { test, expect, say, pause, users, dbBooking, login, logout, claimShift, goTab, toast, openRoom, payOnBoard, waitIdle, roomCard, field, cairoDate, digits, openMore } from "./helpers";

test("03 - الإلغاء (الفلوس بتفضل في الفندق)، المغادرة المبكرة، والتسكين المكرر", async ({ page, env }) => {
  await users(env);
  await env.seedBooking({ room: 605, guest: "ملغي بدون فلوس", nights: 1, price: 100 });
  await env.seedBooking({ room: 606, guest: "ملغي مدفوع", nights: 1, price: 150 });
  await env.seedBooking({ room: 607, guest: "مغادرة مبكرة", nights: 3, price: 100 });
  await env.seedBooking({ room: 608, guest: "نزيل قديم", start: -2, nights: 4, price: 100 });
  await page.goto("/");
  await say(page, "١) موظف الشيفت يحصّل من أكتر من حجز (كل دفعة بوسيلتها)", 2200);
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
  await say(page, "الإقامة اتقصّرت والمدفوع بيفضل متحصّل - مفيش رد فلوس تلقائي", 1500);
  await roomCard(page).getByRole("button", { name: /تأكيد المغادرة المبكرة/ }).click(); await expect(toast(page)).toContainText("غادر مبكرًا"); await pause(page, 3200);

  await say(page, "٣) تسكين مكرر: نزيل جديد على غرفة ٦٠٨ فيها نزيل قديم دخل من يومين", 1800);
  await goTab(page, "الحجوزات");
  await page.getByRole("button", { name: /حجز جديد/ }).click();
  await page.locator(".cx-card[data-calma-editing] select.cx-select").first().selectOption("608");
  await field(page, "اسم النزيل").fill("نزيل بديل");
  await field(page, "تاريخ الخروج").fill(cairoDate(2));
  await page.locator("xpath=//label[contains(.,'السعر لليلة')]/following-sibling::div//input[@type='number']").fill("120");
  await expect(page.getByTestId("duplicate-plan")).toBeVisible(); await pause(page, 3000);
  await say(page, "الحفظ بيسجّل القديم 'غادر مبكرًا' ويتحاسب على ليلتين، والنزيل الجديد بياخد الغرفة", 1500);
  await page.getByRole("button", { name: /حفظ الحجز/ }).click(); await expect(toast(page)).toContainText("تم الحفظ"); await pause(page, 3500);
  await logout(page);

  await say(page, "٤) مدير الحجوزات (روان): بتلغي حجز مدفوع - الفلوس المتحصّلة بتفضل في الفندق (مفيش رد فلوس)", 2200);
  await login(page, "rawan"); await goTab(page, "الحجوزات"); await pause(page, 1800);
  await page.getByTestId("status-filter-all").click().catch(() => {});
  await page.locator(".cx-card", { hasText: "ملغي مدفوع" }).last().locator("button").first().click(); await pause(page, 1500);
  await openMore(page);
  await page.locator("xpath=//label[contains(.,'الحالة')]/following-sibling::select").selectOption("ملغي"); await pause(page, 1800);
  await expect(page.getByText(/بعد الإلغاء الفلوس دي بتفضل في الفندق \(مفيش رد فلوس\)/)).toBeVisible();
  await say(page, "الشاشة بتوضّح قبل الحفظ: الفلوس هتفضل في الفندق", 2400);
  await page.getByRole("button", { name: /حفظ الحجز/ }).click(); await expect(toast(page)).toContainText("فضلت في الفندق"); await pause(page, 3000);
  await expect(page.getByTestId("refund-status").first()).toContainText("فضلت في الفندق");
  const b = await dbBooking(env, "ملغي مدفوع");
  expect(b.status).toBe("ملغي"); expect(Number(b.amount_paid)).toBe(150); expect(b.refund_pending).toBe(false);
  await say(page, "المدفوع ١٥٠ لسه متحصّل ومفيش طلب رد - والتقرير بيعدّه تحصيل حقيقي", 2800);
  await goTab(page, "التقارير");
  await say(page, "التقرير: التحصيل شامل الحجز الملغي اللي فلوسه فضلت في الفندق", 3500);
  await page.mouse.wheel(0, 900); await pause(page, 3000);
});
