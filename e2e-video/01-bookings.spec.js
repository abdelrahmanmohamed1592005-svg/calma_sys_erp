import { test, expect, say, pause, users, dbBooking, login, claimShift, goTab, field, toast, cairoDate, openRoom, openMore, roomCard, payOnBoard, waitIdle } from "./helpers";

test("01 - الحجوزات: التحقق من المدخلات، أكواد الأفراد، الأونلاين، التسكين المكرر، لوحة الغرف", async ({ page, env }) => {
  await users(env);
  // نزيل ساكن في ٦٠٢ (للتسكين المكرر) وحجز مستقبلي في ٦٠٣ (حجز مزدوج مرفوض)
  await env.seedBooking({ room: 602, guest: "نزيل ساكن", start: -1, nights: 3, price: 100 });
  await env.seedBooking({ room: 603, guest: "حجز مستقبلي", start: 3, nights: 2, price: 100 });
  await page.goto("/");
  await say(page, "١) تسجيل دخول موظف الشيفت (أحمد)", 1800);
  await login(page, "ahmed");
  await say(page, "٢) اختيار الشيفت - مرة واحدة بس ومينفعش يتغيّر", 1800);
  await claimShift(page); await pause(page);

  await goTab(page, "الحجوزات");
  await say(page, "٣) حجز جديد: الحفظ من غير بيانات بيترفض برسالة واضحة", 1500);
  await page.getByRole("button", { name: /حجز جديد/ }).click();
  const form = page.locator(".cx-card[data-calma-editing]");
  await form.getByRole("button", { name: /حفظ الحجز/ }).click(); await pause(page, 2200);

  await say(page, "اختيار الغرفة واسم النزيل وسعر الليلة - السعر السالب مرفوض", 1500);
  await form.locator("select.cx-select").first().selectOption("601");
  await field(page, "اسم النزيل").fill("أحمد علي");
  const price = page.locator("xpath=//label[contains(.,'السعر لليلة')]/following-sibling::div//input[@type='number']");
  await price.fill("-50"); await form.getByRole("button", { name: /حفظ الحجز/ }).click(); await pause(page, 2200);
  await price.fill("100");
  await field(page, "تاريخ الخروج").fill(cairoDate(2)); await pause(page, 1200);
  await say(page, "الإجمالي بيتحسب لوحده (٢ ليلة × ١٠٠ = ٢٠٠) والمتبقي = ٢٠٠", 2200);

  await say(page, "٤) دفعة مقدّمة أكبر من الإجمالي: مرفوضة", 1200);
  await page.getByTestId("advance-amount").fill("999"); await form.getByRole("button", { name: /حفظ الحجز/ }).click(); await pause(page, 2200);
  await say(page, "فيزا بأقل من ٤ أرقام: مرفوضة (المطلوب آخر ٤ أرقام بس)", 1200);
  await page.getByTestId("advance-amount").fill("50");
  await page.getByTestId("advance-method").selectOption("فيزا");
  await page.getByTestId("advance-last4").fill("12"); await form.getByRole("button", { name: /حفظ الحجز/ }).click(); await pause(page, 2200);
  await say(page, "فودافون من غير رقم تليفون: مرفوض (اسم + رقم بس، من غير رقم عملية)", 1200);
  await page.getByTestId("advance-method").selectOption("فودافون كاش"); await form.getByRole("button", { name: /حفظ الحجز/ }).click(); await pause(page, 2200);

  await say(page, "٥) أكواد الأفراد: عدد الأفراد ٢ ← زرار 'املا الفاضي تلقائيًا'", 1200);
  await page.getByTestId("advance-method").selectOption("فيزا");
  await page.getByTestId("advance-last4").fill("4242");
  await field(page, "عدد الأفراد").fill("2");
  await page.getByTestId("guest-codes-auto").click(); await pause(page, 2000);
  await say(page, "نفس الكود لفردين في نفس الحجز: مرفوض", 1200);
  await page.getByTestId("guest-code-input-2").fill(await page.getByTestId("guest-code-input-1").inputValue());
  await form.getByRole("button", { name: /حفظ الحجز/ }).click(); await pause(page, 2400);
  await page.getByTestId("guest-codes-auto").click();
  await page.getByTestId("guest-code-input-2").fill("");
  await page.getByTestId("guest-codes-auto").click(); await pause(page, 800);
  await say(page, "٦) حفظ الحجز بدفعة ٥٠ فيزا (****4242) - المتبقي ١٥٠", 1500);
  await form.getByRole("button", { name: /حفظ الحجز/ }).click(); await expect(form).toHaveCount(0); await pause(page, 2200);
  expect(Number((await dbBooking(env, "أحمد علي")).amount_paid)).toBe(50);

  await say(page, "٧) قايمة الحجوزات: حالة الدفع تلقائية (دفع جزئي) وكود الحجز تلقائي", 2600);
  await say(page, "البحث بالاسم / الغرفة / الكود، والتصفية بالحالة والتاريخ", 1200);
  const search = page.getByPlaceholder("بحث برقم الغرفة أو الاسم أو الكود");
  await search.fill("أحمد"); await pause(page, 1800);
  await search.fill("603"); await pause(page, 1800);
  await search.fill(""); await page.getByTestId("status-filter-cancelled").click(); await pause(page, 1500);
  await page.getByTestId("status-filter-all").click(); await pause(page, 1000);

  await say(page, "٨) حجز مدفوع أونلاين (Booking.com): سعر الغرفة اتدفع للمنصة والفندق بيحصّل الخدمات بس", 1500);
  await page.getByRole("button", { name: /حجز جديد/ }).click();
  await page.locator(".cx-card[data-calma-editing] select.cx-select").first().selectOption("604");
  await field(page, "اسم النزيل").fill("نزيل المنصة");
  await field(page, "تاريخ الخروج").fill(cairoDate(2));
  await page.locator("xpath=//label[contains(.,'السعر لليلة')]/following-sibling::div//input[@type='number']").fill("120");
  await openMore(page);
  await page.getByRole("checkbox", { name: /الحجز مدفوع أونلاين/ }).check(); await pause(page, 1800);
  await page.locator("xpath=//label[contains(.,'جهة الحجز')]/following-sibling::select").selectOption("Booking.com");
  await page.getByPlaceholder("مثلاً: رقم حجز Booking.com").fill("BK-778899"); await pause(page, 1200);
  await page.getByRole("button", { name: /حفظ الحجز/ }).click(); await expect(page.locator(".cx-card[data-calma-editing]")).toHaveCount(0); await pause(page, 2200);

  await say(page, "٩) تسكين مكرر: حجز على غرفة فيها نزيل ساكن - السيستم بيشرح اللي هيحصل قبل الحفظ", 1500);
  await page.getByRole("button", { name: /حجز جديد/ }).click();
  await page.locator(".cx-card[data-calma-editing] select.cx-select").first().selectOption("602");
  await field(page, "اسم النزيل").fill("نزيل جديد");
  await field(page, "تاريخ الخروج").fill(cairoDate(2));
  await page.locator("xpath=//label[contains(.,'السعر لليلة')]/following-sibling::div//input[@type='number']").fill("100");
  await expect(page.getByTestId("duplicate-plan")).toBeVisible(); await pause(page, 3600);
  await page.getByRole("button", { name: "إلغاء", exact: true }).click();

  await say(page, "حجز على غرفة فيها حجز مستقبلي: مرفوض (حجز مزدوج حقيقي مش خروج مبكر)", 1500);
  await page.getByRole("button", { name: /حجز جديد/ }).click();
  await page.locator(".cx-card[data-calma-editing] select.cx-select").first().selectOption("603");
  await field(page, "اسم النزيل").fill("حجز مزدوج");
  await field(page, "تاريخ الدخول").fill(cairoDate(3));
  await field(page, "تاريخ الخروج").fill(cairoDate(4));
  await expect(page.getByTestId("duplicate-blocked")).toBeVisible(); await pause(page, 3200);
  await page.getByRole("button", { name: "إلغاء", exact: true }).click();

  await goTab(page, "لوحة الغرف");
  await say(page, "١٠) لوحة الغرف: ألوان الحالات، نسبة الإشغال، وتحصيل/مصاريف اليوم", 2600);
  await say(page, "البحث بكود النزيل بيطلّع الغرفة اللي سكن فيها", 1200);
  await openRoom(page, 601); await pause(page, 1800);
  await say(page, "بطاقة الغرفة: الإجمالي / المدفوع / المتبقي + حالة الدفع التلقائية", 2400);
  await say(page, "رسوم إضافية (جولات) تتضاف على طول، والمتبقي بيتحدّث", 1200);
  await page.locator("xpath=//label[contains(.,'جولات')]/following-sibling::input").fill("30");
  await page.getByRole("button", { name: /حفظ الرسوم/ }).click(); await pause(page, 2400);
  await say(page, "دخول مبكر: رسم ٢٠ بيتحصّل كاش في نفس اللحظة ويتسجّل في اليومية", 1200);
  await page.getByTestId("early-fee").fill("20"); await page.getByTestId("early-apply").click(); await waitIdle(page); await pause(page, 2400);
  await say(page, "تمديد الإقامة ليلة: التاريخ والإجمالي والمتبقي بيتحدّثوا لوحدهم", 1200);
  await page.getByRole("button", { name: /تمديد الحجز/ }).click(); await pause(page, 2600);
  await say(page, "وفي الآخر: كل ده اتحسب في اليومية والتقرير (شوف الفيديوهات الجاية)", 2400);
});
