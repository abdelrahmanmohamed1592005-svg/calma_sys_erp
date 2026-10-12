import { test, expect, say, pause, users, dbBooking, login, logout, claimShift, goTab, toast, openRoom, payOnBoard, waitIdle, roomCard, cairoDate, digits } from "./helpers";

const addStaff = async (page, { who, desc, amount, mode, last4, manual }) => {
  await page.getByTestId("staff-cafe-who").selectOption(who);
  if (manual) await page.getByTestId("staff-cafe-manual").fill(manual);
  if (desc) await page.getByTestId("staff-cafe-desc").fill(desc);
  await page.getByTestId("staff-cafe-amount").fill(String(amount));
  if (mode) await page.getByTestId("staff-cafe-paymode").selectOption(mode);
  if (last4) await page.getByTestId("staff-cafe-last4").fill(last4);
  await page.getByTestId("staff-cafe-add").click(); await waitIdle(page);
};

test("04 - الكافيتيريا: خدمات النزلاء بتتسجّل لوحدها + كافيتيريا الاستاف (مين أخد ومين دفع ومين عليه فلوس)", async ({ page, env }) => {
  await users(env);
  await env.seedBooking({ room: 607, guest: "نزيل الكافيتيريا", nights: 1, price: 100, total: 100, extras: { laundry: 0, cafeteria: 50, tours: 0, pickup: 0 } });
  await env.q(`insert into staff_cafeteria(day, shift_key, consumer_username, consumer_name, description, amount, currency, recorded_by) values ($1, 'evening', 'sara', 'سارة', 'مديونية قديمة من ٣ أيام', 80, 'EGP', 'old')`, [cairoDate(-3)]);
  await page.goto("/");
  await login(page, "ahmed"); await claimShift(page);
  await say(page, "١) نزيل في ٦٠٧ طلب خدمة كافيتيريا ٥٠ (اتضافت على حسابه) - ولسه ماتحصّلتش", 2200);
  await goTab(page, "اليومية");
  await say(page, "اليومية بتبيّن إن على النزيل كافيتيريا لسه ماتحصّلتش", 1500);
  await page.getByTestId("cafeteria-guest-due").scrollIntoViewIfNeeded(); await pause(page, 2800);

  await goTab(page, "لوحة الغرف"); await openRoom(page, 607);
  await say(page, "٢) النزيل بيدفع ٧٠ بالفيزا: الدفعة بتسدّد الكافيتيريا الأول (٥٠) والباقي (٢٠) للغرفة", 2400);
  await payOnBoard(page, { amount: 70, method: "فيزا", last4: "5555" }); await pause(page, 3200);
  await goTab(page, "اليومية");
  await say(page, "٣) في اليومية: ٥٠ ظهرت في قسم الكافيتيريا تلقائي (فيزا ****5555) و٢٠ على صف الغرفة", 1500);
  await page.getByTestId("cafeteria-rows").scrollIntoViewIfNeeded(); await pause(page, 3800);
  await say(page, "والفيزا كلها (٧٠) في عهدة الفيزا من غير ما تتحسب مرتين", 1500);
  await page.getByTestId("method-transactions").first().scrollIntoViewIfNeeded(); await pause(page, 3000);

  await say(page, "٤) كافيتيريا الاستاف: مديونية قديمة (سارة عليها ٨٠ من ٣ أيام) بتفضل ظاهرة لحد ما تسدّد", 2200);
  await page.getByTestId("staff-cafe-form").scrollIntoViewIfNeeded(); await pause(page, 2500);
  await say(page, "سارة أخدت قهوة وساندوتش ٦٠ ولسه مادفعتش ← عليها فلوس", 1200);
  await addStaff(page, { who: "sara", desc: "قهوة وساندوتش", amount: 60, mode: "later" }); await pause(page, 2600);
  await say(page, "موظف مش على السيستم (اسم يدوي): عم حسن أخد شاي ١٠ آجل", 1200);
  await addStaff(page, { who: "__manual__", manual: "عم حسن", desc: "شاي", amount: 10, mode: "later" }); await pause(page, 2600);
  await say(page, "أحمد أخد وجبة ٩٠ ودفع فيزا على طول (آخر ٤ أرقام ٨٨٨٨) ← بيدخل الكافيتيريا في اليومية", 1400);
  await addStaff(page, { who: "ahmed", desc: "وجبة", amount: 90, mode: "فيزا", last4: "8888" }); await pause(page, 2800);
  await say(page, "فيزا من غير ٤ أرقام: مرفوضة", 1200);
  await addStaff(page, { who: "ahmed", desc: "x", amount: 5, mode: "فيزا" }); await pause(page, 2200);

  await say(page, "٥) سداد جزئي من سارة (٤٠ فيزا ****3333): بيتوزّع على أقدم مديونية، والباقي عليها", 1500);
  const sara = page.getByTestId("staff-cafe-balance").filter({ hasText: "سارة" });
  await sara.getByTestId("staff-cafe-settle-open").click(); await pause(page, 1000);
  await page.getByTestId("staff-cafe-pay-amount").fill("40");
  await page.getByTestId("staff-cafe-pay-method").selectOption("فيزا");
  await page.getByTestId("staff-cafe-pay-last4").fill("3333"); await pause(page, 1200);
  await page.getByTestId("staff-cafe-pay-go").click(); await waitIdle(page); await pause(page, 3000);
  await say(page, "سداد أكتر من المديونية: مرفوض", 1200);
  await page.getByTestId("staff-cafe-balance").filter({ hasText: "سارة" }).getByTestId("staff-cafe-settle-open").click();
  await page.getByTestId("staff-cafe-pay-amount").fill("9999"); await page.getByTestId("staff-cafe-pay-go").click(); await pause(page, 2400);
  await say(page, "نسدّد الباقي كله كاش (المبلغ فاضي = كل اللي عليها)", 1300);
  await page.getByTestId("staff-cafe-pay-amount").fill("");
  await page.getByTestId("staff-cafe-pay-method").selectOption("كاش");
  await page.getByTestId("staff-cafe-pay-go").click(); await waitIdle(page); await pause(page, 3000);
  await say(page, "سارة اتشالت من اللي عليهم فلوس، وعم حسن لسه عليه ١٠", 2600);
  await page.getByTestId("cafeteria-rows").scrollIntoViewIfNeeded(); await pause(page, 3200);

  await say(page, "٦) إقفال الشيفت: خانات الكافيتيريا بتتقفل، والإجماليات (شاملة الكافيتيريا) بتتحفظ", 1500);
  await page.getByRole("button", { name: /إقفال الشيفت/ }).click(); await expect(page.getByText(/أُقفل بواسطة/)).toBeVisible(); await pause(page, 3000);
  await expect(page.getByTestId("staff-cafe-form")).toHaveCount(0);
  await logout(page);

  await say(page, "٧) مديرة الحسابات: تقرير الكافيتيريا (من النزلاء / سداد الاستاف) والاستاف اللي عليهم فلوس", 2200);
  await login(page, "mona"); await goTab(page, "التقارير");
  await page.getByTestId("report-cafeteria").scrollIntoViewIfNeeded(); await pause(page, 5000);
  await page.getByTestId("report-staff-owed").scrollIntoViewIfNeeded(); await pause(page, 3500);
  expect(digits(await page.getByTestId("report-staff-owed").innerText())).toContain("10EGP");
});
