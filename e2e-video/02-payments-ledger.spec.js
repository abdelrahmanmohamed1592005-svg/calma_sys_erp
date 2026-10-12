import { test, expect, say, pause, users, dbBooking, login, logout, claimShift, goTab, toast, openRoom, payOnBoard, waitIdle, roomCard, showAllRooms, digits } from "./helpers";

const lrow = (page, n) => page.locator("table.cx-table tbody tr", { hasText: String(n) }).first();

test("02 - الدفع بكل الوسائل: فيزا/فودافون/كاش، الحالة التلقائية، اليومية وعهدة الفيزا، إقفال الشيفت", async ({ page, env }) => {
  await users(env);
  await env.seedBooking({ room: 601, guest: "نزيل الدفع", nights: 3, price: 100 });
  await page.goto("/");
  await say(page, "١) موظف الشيفت يسجّل دخول ويختار شيفته", 1800);
  await login(page, "ahmed"); await claimShift(page);
  await goTab(page, "لوحة الغرف");
  await say(page, "٢) الغرفة ٦٠١ عليها نزيل ولسه مدفعش (الغرفة حمراء) - إجمالي ٣٠٠", 2200);
  await openRoom(page, 601); await pause(page, 1800);

  await say(page, "٣) تسجيل دفعة: مبلغ أكبر من المتبقي مرفوض", 1200);
  await payOnBoard(page, { amount: 500 }); await pause(page, 2000);
  await say(page, "فيزا من غير ٤ أرقام: مرفوضة", 1200);
  await payOnBoard(page, { amount: 50, method: "فيزا", last4: "99" }); await pause(page, 2000);
  await say(page, "تحويل من غير رقم تليفون: مرفوض", 1200);
  await payOnBoard(page, { amount: 50, method: "تحويل بنكي / انستاباي" }); await pause(page, 2000);

  await say(page, "٤) دفعة كاش ١٠٠ ← الحالة بقت 'دفع جزئي' والمتبقي ٢٠٠", 1200);
  await payOnBoard(page, { amount: 100, method: "كاش" }); await pause(page, 2600);
  await say(page, "٥) دفعة فيزا ١٢٠: خانة واحدة بس (آخر ٤ أرقام الكارت)", 1200);
  await page.getByTestId("collect-method").selectOption("فيزا"); await pause(page, 1500);
  await payOnBoard(page, { amount: 120, method: "فيزا", last4: "1111" }); await pause(page, 2600);
  await say(page, "٦) فيزا ٣٠ بكارت تاني (٢٢٢٢): هيتسجّل في صف منفصل (مفيش دمج بين كارتين)", 1200);
  await payOnBoard(page, { amount: 30, method: "فيزا", last4: "2222" }); await pause(page, 2600);
  await say(page, "٧) فودافون كاش ٥٠: اسم المرسل + رقم التليفون (مفيش رقم عملية)", 1200);
  await page.getByTestId("collect-method").selectOption("فودافون كاش"); await pause(page, 1500);
  await payOnBoard(page, { amount: 50, method: "فودافون كاش", senderName: "كريم", phone: "01012345678" }); await pause(page, 2800);
  await say(page, "الحجز بقى 'مدفوع بالكامل' لوحده - مفيش علامة بتتعلّم ولا زرار تحصيل كامل", 2800);
  expect((await dbBooking(env, "نزيل الدفع")).settled).toBe(true);
  await say(page, "لوحة الغرف: الغرفة بقت 'مشغولة - متحصّلة' وتحصيل اليوم اتحدّث", 2400);
  await page.evaluate(() => window.scrollTo(0, 0)); await pause(page, 2000);

  await goTab(page, "اليومية");
  await say(page, "٨) اليومية: كل دفعة في صف وسيلتها بتفاصيلها (كاش / فيزا ****1111 / فيزا ****2222 / فودافون)", 3200);
  await pause(page, 2500);
  await say(page, "عهدة الفيزا: كل عملية بتفاصيلها (****1111 و****2222) والإجمالي دلوقتي", 1500);
  await page.getByTestId("method-transactions").first().scrollIntoViewIfNeeded(); await pause(page, 3800);

  await say(page, "٩) مصروف في اليومية (نظافة ٥٠ جنيه) بيتخصم من رصيد الخزينة الكاش", 1500);
  await showAllRooms(page);
  const r = lrow(page, 602);
  await r.locator("select.cx-select").nth(0).selectOption("نظافة");
  await r.getByPlaceholder("البيان", { exact: true }).fill("مناديل ومنظفات");
  await r.getByPlaceholder("المبلغ").nth(0).fill("50"); await pause(page, 2000);
  await say(page, "١٠) صف فيزا يدوي من غير آخر ٤ أرقام ← إقفال الشيفت مرفوض", 1500);
  await r.locator("select.cx-select").nth(2).selectOption("فيزا");
  await r.getByPlaceholder("المبلغ").nth(1).fill("100");
  await r.locator("select.cx-select").nth(3).selectOption("USD"); await pause(page, 1500);
  await page.getByRole("button", { name: /إقفال الشيفت/ }).click(); await pause(page, 3200);
  await say(page, "نكتب آخر ٤ أرقام (٦٧٨٩) ← الإقفال بيعدّي", 1200);
  await r.locator('input[placeholder="آخر ٤ أرقام الكارت"]').fill("6789"); await pause(page, 1200);
  await page.getByRole("button", { name: /إقفال الشيفت/ }).click();
  await expect(page.getByText(/أُقفل بواسطة/)).toBeVisible();
  await say(page, "١١) الشيفت اتقفل: كل الخانات مقفولة، والأرصدة اتحفظت (رصيد الخزينة + عهدة الفيزا)", 3200);
  await page.getByTestId("method-transactions").first().scrollIntoViewIfNeeded(); await pause(page, 2800);

  await logout(page);
  await say(page, "١٢) مدير الحجوزات يقدر يفتح الشيفت المقفول لو الموظف قفله بالغلط", 1800);
  await login(page, "rawan"); await goTab(page, "اليومية");
  await page.getByRole("button", { name: /استعراض شيفتات سابقة/ }).click(); await pause(page, 2200);
  await page.getByRole("button", { name: /إعادة فتح الشيفت/ }).click(); await expect(toast(page)).toContainText("تم إعادة فتح الشيفت"); await pause(page, 2600);
  await say(page, "مدير الحجوزات يشوف اليومية للقراءة بس - ومفيش عنده خانات تسجيل دفع", 2800);
});
