import { test, expect, say, pause, users, login, logout, goTab, toast, field, showAllRooms, setCairoTime, SHIFT_LABEL, addBooking, waitIdle, waitLedgerSaved, digits } from "./helpers";

const lrow = (page, n) => page.locator("table.cx-table tbody tr", { hasText: String(n) }).first();
const claim = async (page, key) => { await goTab(page, "اليومية"); await page.getByRole("button", { name: new RegExp(SHIFT_LABEL[key]) }).click(); await expect(page.getByText("شيفتك الوحيد المتاح ليك النهارده")).toBeVisible(); };

test("07 - الشيفتات والوقت: اختيار الشيفت، العهدة بتتنقل، الإقفال التلقائي، الشيفت الليلي، ومتابعة المشاكل", async ({ page, env }) => {
  await users(env);
  await setCairoTime(page, 10, 0);
  await page.goto("/");
  await say(page, "١) الساعة ١٠ص: موظف الصباحي يختار شيفته - الشيفتات التانية مقفولة لحد معادها", 2200);
  await login(page, "ahmed"); await goTab(page, "اليومية"); await pause(page, 2400);
  await claim(page, "morning"); await showAllRooms(page); await pause(page, 1500);
  await say(page, "العهدة (الكاش اللي في الدرج أول الشيفت): ٥٠٠ جنيه", 1500);
  const egp = page.locator(".cx-card", { hasText: "جنيه (EGP)" }).last();
  await egp.locator('input[type="number"]').first().fill("500"); await pause(page, 1500);
  await say(page, "تحصيل كاش ٢٠٠ ومصروف ٥٠ ← رصيد الخزينة = ٥٠٠ + ٢٠٠ - ٥٠ = ٦٥٠", 1500);
  const r = lrow(page, 601);
  await r.getByPlaceholder("بيان التحصيل").fill("حجز مباشر");
  await r.getByPlaceholder("المبلغ").nth(1).fill("200");
  await r.locator("select.cx-select").nth(0).selectOption("نظافة");
  await r.getByPlaceholder("المبلغ").nth(0).fill("50");
  await waitLedgerSaved(page); await pause(page, 2500);
  await egp.scrollIntoViewIfNeeded(); await pause(page, 2600);
  await say(page, "إقفال الشيفت: بيتحفظ الرصيد (٦٥٠) وكل الخانات بتتقفل", 1500);
  await page.getByRole("button", { name: /إقفال الشيفت/ }).click(); await expect(page.getByText(/أُقفل بواسطة/)).toBeVisible(); await pause(page, 3000);
  await logout(page);

  await say(page, "٢) الساعة ٥م: موظفة المسائي (سارة) - العهدة بتتنقل لوحدها من إقفال الصباحي (٦٥٠)", 2400);
  await setCairoTime(page, 17, 0);
  await login(page, "sara"); await claim(page, "evening"); await pause(page, 1500);
  const egp2 = page.locator(".cx-card", { hasText: "جنيه (EGP)" }).last();
  await expect(egp2.locator('input[type="number"]').first()).toHaveValue("650"); await egp2.scrollIntoViewIfNeeded(); await pause(page, 3200);
  await say(page, "حجز بدفعة فيزا (****9090) من نفس الشيفت", 1500);
  await addBooking(page, { room: 603, guest: "نزيلة المسائي", price: 100, nights: 1, paid: 100, method: "فيزا", last4: "9090" }); await pause(page, 2400);
  await goTab(page, "اليومية"); await showAllRooms(page);
  await say(page, "علّمنا الشيفت 'فيه مشكلة تحتاج متابعة' ومعاها ملاحظة", 1500);
  await page.locator('input[type="checkbox"]').last().check();
  await page.getByPlaceholder("ملاحظات الشيفت").fill("عجز ٥٠ جنيه في الدرج - لازم مراجعة"); await waitLedgerSaved(page); await pause(page, 2600);
  await logout(page);

  await say(page, "٣) الساعة ٢٠:٣٠ بعد منتصف الليل: الشيفت الليلي بيتسجّل على يوم المسائي اللي قبله", 2400);
  await setCairoTime(page, 0, 30);
  await login(page, "ahmed"); await goTab(page, "اليومية"); await pause(page, 1500);
  await page.getByRole("button", { name: new RegExp(SHIFT_LABEL.night) }).click(); await expect(page.getByText("شيفتك الوحيد المتاح ليك النهارده")).toBeVisible(); await pause(page, 2400);
  await say(page, "أول ما الليلي يبدأ: المسائي اتقفل تلقائيًا (إقفال تلقائي) وعهدة الكاش وعهدة الفيزا اتنقلوا", 2600);
  await showAllRooms(page); await page.locator(".cx-card", { hasText: "عهدة وسائل الدفع الأخرى" }).last().scrollIntoViewIfNeeded(); await pause(page, 3800);
  await logout(page);

  await say(page, "٤) مدير الحجوزات يشوف الشيفتات اللي فيها مشاكل في التقرير ويقدر يفتح أي شيفت مقفول", 2200);
  await login(page, "rawan"); await goTab(page, "التقارير"); await pause(page, 2000);
  await page.mouse.wheel(0, 1800); await pause(page, 3800);
  await say(page, "(الموظف مايقدرش يغيّر الشيفت اللي اختاره، والمدير العام بس يلغي اختيار غلط)", 3000);
});
