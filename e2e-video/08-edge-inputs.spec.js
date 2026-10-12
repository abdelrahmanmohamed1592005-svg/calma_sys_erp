import { test, expect, say, pause, users, dbBooking, login, claimShift, goTab, toast, openRoom, payOnBoard, waitIdle } from "./helpers";

test("08 - إدخالات غريبة وضغط سريع: أرقام عربية، مبالغ غلط، كسور، ضغط مزدوج، نص خبيث", async ({ page, env }) => {
  await users(env);
  await env.seedBooking({ room: 601, guest: "نزيل الاختبار", nights: 2, price: 100 });
  await page.goto("/");
  await say(page, "١) موظف الشيفت يفتح شيفته ويفتح غرفة ٦٠١ (إجمالي ٢٠٠)", 1800);
  await login(page, "ahmed"); await claimShift(page);
  await goTab(page, "لوحة الغرف"); await openRoom(page, 601); await pause(page, 1500);

  await say(page, "٢) مبالغ غلط: صفر وسالب وأكبر من المتبقي - كلها مرفوضة ومفيش حاجة بتتسجّل", 1500);
  for (const bad of ["0", "-5", "200.01", "99999"]) {
    await page.getByTestId("pay-amount").fill(bad);
    await page.getByTestId("pay-record").click(); await waitIdle(page); await pause(page, 1100);
  }
  expect(Number((await dbBooking(env, "نزيل الاختبار")).amount_paid)).toBe(0);

  await say(page, "٣) كسور: ٣٣٫٣٣٣ بتتقرّب لقرشين (٣٣٫٣٣)", 1500);
  await payOnBoard(page, { amount: "33.333" }); await pause(page, 2200);
  expect(Number((await dbBooking(env, "نزيل الاختبار")).amount_paid)).toBe(33.33);

  await say(page, "٤) آخر ٤ أرقام الفيزا بأرقام عربية (٤٢٤٢) بتتحفظ ٤٢٤٢ عادي", 1500);
  await payOnBoard(page, { amount: 50, method: "فيزا", last4: "٤٢٤٢" }); await pause(page, 2400);

  await say(page, "٥) ضغط مزدوج سريع على 'تسجيل الدفعة': دفعة واحدة بس", 1500);
  await page.getByTestId("collect-method").selectOption("كاش");
  await page.getByTestId("pay-amount").fill("20");
  await page.getByTestId("pay-record").dblclick(); await waitIdle(page); await pause(page, 2400);
  expect(Number((await dbBooking(env, "نزيل الاختبار")).amount_paid)).toBe(103.33);

  await say(page, "٦) نص خبيث في اسم نزيل جديد: بيتعرض كنص عادي ومفيش سكريبت بيتنفّذ", 1500);
  let dialogs = 0; page.on("dialog", async (d) => { dialogs++; await d.dismiss(); });
  await env.seedBooking({ room: 602, guest: "<img src=x onerror=alert(1)> نزيل", nights: 1, price: 50 });
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange"))); await pause(page, 2200);
  expect(dialogs).toBe(0);
  await say(page, "٧) اليومية: كل الدفعات متسجّلة بالتفاصيل (كاش + فيزا ****٤٢٤٢) والمجموع مطابق", 2200);
  await goTab(page, "اليومية"); await pause(page, 3000);
  const total = (await env.q("select rows from shift_records"))[0].rows.reduce((a, r) => a + (Number(r.collectionAmt) || 0), 0);
  expect(Math.round(total * 100) / 100).toBe(103.33);
});
