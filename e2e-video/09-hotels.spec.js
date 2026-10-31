import { test, expect, say, pause, users, login, logout, goTab, toast, openRoom, payOnBoard, claimShift, shiftDay, myShiftKey, SHIFT_LABEL, boardTile } from "./helpers";

const hotelSelect = (page) => page.getByLabel("الفندق", { exact: true });
const pick = async (page, name) => { await hotelSelect(page).selectOption({ label: name }); await expect(page.locator(".cx-tile").first()).toBeVisible(); await pause(page, 900); };

test("09 - الفنادق المتعددة H&S: بروفايل مستقل لكل فندق، توزيع الموظفين، تحصيل كل فندق في يوميته، وتقارير المدير العام", async ({ page, env }) => {
  await users(env);
  await env.seedBooking({ room: 603, guest: "نزيل Calma", nights: 3, price: 100, total: 300, start: -1 });
  await env.seedBooking({ room: 207, guest: "نزيل Revento", nights: 3, price: 100, total: 300, start: -1 });
  await env.seedBooking({ room: 412, guest: "نزيل Park Plaza", nights: 2, price: 150, total: 300 });
  await env.seedBooking({ room: 304, guest: "نزيل The Location", nights: 2, price: 200, total: 400 });
  await page.goto("/");

  await say(page, "مجموعة H&S: ٤ فنادق - Calma و Revento و Park Plaza و The Location - كل فندق ليه بروفايل مستقل", 3200);
  await login(page, "boss"); await pause(page, 1500);
  await say(page, "المدير العام: مبدّل الفنادق في الهيدر. Calma: ١٦ غرفة (601-616)", 3000);
  await expect(page.locator(".cx-tile")).toHaveCount(16);
  await pick(page, "Revento"); await say(page, "Revento: ٢٥ غرفة من ٢٠١ لـ ٢٢٥", 2600); await expect(page.locator(".cx-tile")).toHaveCount(25);
  await pick(page, "Park Plaza"); await say(page, "Park Plaza: ٣٣ غرفة من ٤٠١ لـ ٤٣٣", 2600); await expect(page.locator(".cx-tile")).toHaveCount(33);
  await pick(page, "The Location"); await say(page, "The Location: ٧ غرف من ٣٠١ لـ ٣٠٧", 2600); await expect(page.locator(".cx-tile")).toHaveCount(7);

  await say(page, "الحجوزات كمان لكل فندق لوحده: هنا نزيل The Location بس", 2600);
  await goTab(page, "الحجوزات"); await pause(page, 1500);
  await expect(page.getByText("نزيل The Location").first()).toBeVisible();
  await expect(page.getByText("نزيل Calma")).toHaveCount(0);
  await pick(page, "Revento"); await expect(page.getByText("نزيل Revento").first()).toBeVisible();
  await say(page, "وفي Revento: نزيل Revento بس", 2400);
  await logout(page);

  await say(page, "الموظفين مشتركين: أحمد بيختار فندق + شيفت النهارده", 2800);
  await login(page, "ahmed"); await pause(page, 1200);
  await pick(page, "Revento");
  await claimShift(page); await pause(page, 1500);
  await say(page, "أحمد اشتغل في Revento: يوميته فيها غرف Revento بس", 2800);
  await goTab(page, "لوحة الغرف"); await openRoom(page, 207);
  await say(page, "بيحصّل ١٢٠ من نزيل غرفة ٢٠٧", 2200);
  await payOnBoard(page, { amount: 120 }); await pause(page, 1500);
  await expect(toast(page)).toBeVisible();
  await say(page, "التحصيل اتسجّل في يومية Revento بس، ويومية Calma ما اتلمستش", 3000);
  await logout(page);

  await say(page, "سارة بتشتغل نفس الشيفت في نفس اليوم لكن في فندق تاني (Calma): مفيش تعارض", 3200);
  await login(page, "sara"); await pause(page, 1000);
  await pick(page, "فندق Calma");
  await claimShift(page); await pause(page, 1500);
  const recs = await env.q("select hotel_id, staff_username from shift_records order by hotel_id");
  expect(recs.map((r) => [r.hotel_id, r.staff_username])).toEqual([[1, "sara"], [2, "ahmed"]]);
  await say(page, "كل فندق ليه يومية مستقلة بموظفه، ونفس الموظف ماينفعش يختار شيفتين في اليوم", 3200);
  await logout(page);

  await say(page, "التقارير: المدير العام بيشوف كل فندق لوحده", 2400);
  await login(page, "boss"); await pause(page, 1000);
  await pick(page, "Revento"); await goTab(page, "التقارير"); await pause(page, 2000);
  await say(page, "تقرير Revento: تحصيل ١٢٠ بس", 2400);
  await page.getByTestId("report-scope-all").click(); await pause(page, 1800);
  await say(page, "وتقرير مجمّع للجروب H&S: ملخص كل فندق + الإجماليات", 3200);
  await expect(page.getByTestId("report-per-hotel")).toBeVisible();
  await pause(page, 2000);
  await logout(page);
});
