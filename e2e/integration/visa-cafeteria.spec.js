/*
  سيناريوهات الفيزا / طرق الدفع / الحالة التلقائية / الكافيتيريا (نزلاء + استاف)
  على قاعدة بيانات Postgres حقيقية ومتصفح حقيقي. كل سيناريو بيتأكد من القاعدة نفسها
  (الحجز + صفوف اليومية + كافيتيريا الاستاف) ومن اللي بيظهر في اللوحة واليومية والتقرير.
*/
import { test, expect } from "../fixtures";
import { login, logout, claimShift, addBooking, goTab, boardTile, roomCard, toast, refresh, digits, cairoDate, openRoom, payOnBoard, showAllRooms, waitIdle } from "../ui";

async function users(env) {
  await env.seedUser("boss", "gm", "المدير");
  await env.seedUser("ahmed", "staff", "أحمد");
  await env.seedUser("sara", "staff", "سارة");
  await env.seedUser("rawan", "reservations", "روان");
  await env.seedUser("mona", "accounts", "منى");
}
const booking = async (env, guest) => (await env.q("select * from bookings where guest_name = $1", [guest]))[0];
const shift = async (env) => (await env.q("select * from shift_records"))[0];
// بعد كل دفعة نستنى الكتابة توصل القاعدة (التوست القديم ممكن يكون لسه ظاهر)
const paidIs = (env, guest, n) => expect.poll(async () => Number((await booking(env, guest)).amount_paid), { timeout: 8000 }).toBe(n);
const nonZero = (rows) => rows.filter((r) => Number(r.collectionAmt) !== 0);

test.describe("الفيزا: كل دفعة بوسيلتها وتفاصيلها", () => {
  test("فيزا بآخر ٤ أرقام: بتروح لصف فيزا (مش كاش) وتظهر في اليومية وعهدة الفيزا والتقرير بنفس التفاصيل", async ({ page, env }) => {
    await users(env);
    await env.seedShift("ahmed");
    await env.seedBooking({ room: 601, guest: "Visa Flow", nights: 2, price: 100 });
    await page.goto("/"); await login(page, "ahmed");
    await goTab(page, "لوحة الغرف"); await openRoom(page, 601);
    // خانة واحدة للفيزا (آخر ٤ أرقام) - مفيش اسم مرسل ولا رقم عملية
    await page.getByTestId("collect-method").selectOption("فيزا");
    await expect(page.getByTestId("pay-last4")).toBeVisible();
    await expect(page.getByTestId("pay-panel").getByPlaceholder("اسم المرسل")).toHaveCount(0);
    await expect(page.getByTestId("pay-panel").getByPlaceholder("رقم العملية / ملاحظة")).toHaveCount(0);
    // من غير ٤ أرقام: مرفوض ومفيش حاجة اتسجّلت
    await page.getByTestId("pay-last4").fill("12");
    await page.getByTestId("pay-record").click();
    await expect(toast(page)).toContainText("آخر ٤ أرقام");
    expect(Number((await booking(env, "Visa Flow")).amount_paid)).toBe(0);
    await page.getByTestId("pay-last4").fill("4242");
    await payOnBoard(page, { amount: 150 });
    await expect(toast(page)).toContainText("المتبقي");
    const b = await booking(env, "Visa Flow");
    expect(b).toMatchObject({ payment_method: "فيزا", settled: false });
    expect(Number(b.amount_paid)).toBe(150);
    const rec = await shift(env);
    const rows = nonZero(rec.rows);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ collectionMethod: "فيزا", collectionAmt: 150, collectionCurrency: "USD", bookingId: b.id });
    expect(rows[0].paymentDetails).toMatchObject({ senderNumber: "4242", senderName: "", ref: "" });
    // مفيش ولا مليم دخل الكاش
    expect(rows.filter((r) => r.collectionMethod === "كاش")).toHaveLength(0);

    // اليومية: صف الغرفة بالفيزا + خانة آخر ٤ أرقام + كارت عهدة الفيزا بتفاصيل العملية
    await goTab(page, "اليومية");
    const trow = page.locator("table.cx-table tbody tr", { hasText: "601" }).first();
    await expect(trow.locator("select.cx-select").nth(2)).toHaveValue("فيزا");
    await expect(trow.locator('input[placeholder="آخر ٤ أرقام الكارت"]')).toHaveValue("4242");
    const tx = page.getByTestId("method-transactions");
    await expect(tx).toContainText("****4242");
    await expect(tx).toContainText("غرفة 601");
    // عهدة الفيزا اتحدّثت لوحدها (١٥٠ حصلت)
    expect(digits(await page.locator(".cx-card", { hasText: "عهدة وسائل الدفع الأخرى" }).first().innerText())).toContain("150");

    // تقرير مدير الحجوزات: جدول تفاصيل الفيزا
    await logout(page); await login(page, "rawan");
    await goTab(page, "التقارير");
    const tbl = page.getByTestId("report-noncash-tx");
    await expect(tbl).toContainText("****4242");
    await expect(tbl).toContainText("فيزا");
    expect(digits(await tbl.innerText())).toContain("150USD");
    // كاش في التقرير = صفر (الفيزا مش داخلة فيه)
    const cashRow = page.locator("table.cx-table tr", { hasText: /^كاش/ }).first();
    expect(digits(await cashRow.innerText())).not.toContain("150");
  });

  test("دفعات بوسائل مختلفة على نفس الحجز (كاش + فيزا + فودافون): كل دفعة في صف وسيلتها، ومفيش لخبطة", async ({ page, env }) => {
    await users(env);
    await env.seedShift("ahmed");
    await env.seedBooking({ room: 602, guest: "Mixed Pay", nights: 1, price: 300 });
    await page.goto("/"); await login(page, "ahmed");
    await goTab(page, "لوحة الغرف"); await openRoom(page, 602);
    await payOnBoard(page, { amount: 100, method: "كاش" });
    await paidIs(env, "Mixed Pay", 100);
    await payOnBoard(page, { amount: 120, method: "فيزا", last4: "1111" });
    await paidIs(env, "Mixed Pay", 220);
    // فيزا تانية بكارت مختلف: صف منفصل
    await payOnBoard(page, { amount: 30, method: "فيزا", last4: "2222" });
    await paidIs(env, "Mixed Pay", 250);
    // فودافون: اسم + رقم (من غير رقم عملية)
    await payOnBoard(page, { amount: 50, method: "فودافون كاش", senderName: "Mohamed", phone: "01012345678" });
    await paidIs(env, "Mixed Pay", 300);
    await expect(toast(page)).toContainText("الحجز مدفوع بالكامل");
    const b = await booking(env, "Mixed Pay");
    expect(Number(b.amount_paid)).toBe(300);
    expect(b.settled).toBe(true);
    const rows = nonZero((await shift(env)).rows);
    expect(rows.map((r) => `${r.collectionMethod}:${r.collectionAmt}:${r.paymentDetails.senderNumber}:${r.paymentDetails.senderName}`)).toEqual([
      "كاش:100::", "فيزا:120:1111:", "فيزا:30:2222:", "فودافون كاش:50:01012345678:Mohamed",
    ]);
    // مجموع الصفوف = مجموع المدفوع بالظبط
    expect(rows.reduce((s, r) => s + Number(r.collectionAmt), 0)).toBe(300);
    // بطاقة الغرفة بتبيّن المدفوع بالوسيلة وتفاصيلها (من اليومية): مفيش لخبطة
    const pb = page.getByTestId("pay-breakdown");
    await expect(pb).toContainText("كاش"); await expect(pb).toContainText("****1111"); await expect(pb).toContainText("****2222");
    await expect(pb).toContainText("Mohamed");
    expect(digits(await pb.innerText())).toContain("120");
    // نفس التفصيل في قايمة الحجوزات
    await goTab(page, "الحجوزات");
    const lb = page.locator(".cx-card", { hasText: "Mixed Pay" }).last().getByTestId("pay-breakdown");
    await expect(lb).toContainText("****1111"); await expect(lb).toContainText("فودافون كاش");
    await goTab(page, "لوحة الغرف"); await openRoom(page, 602);
    // الحالة تلقائية: الغرفة بقت متحصّلة
    await expect(page.getByText(/مشغولة - متحصّلة 1/)).toBeVisible();
  });

  test("تحقق المدخلات: مبلغ أكبر من المتبقي، فيزا من غير ٤ أرقام، تحويل من غير رقم - مفيش حاجة بتتسجّل", async ({ page, env }) => {
    await users(env);
    await env.seedShift("ahmed");
    await env.seedBooking({ room: 603, guest: "Validate Pay", nights: 1, price: 100 });
    await page.goto("/"); await login(page, "ahmed");
    await goTab(page, "لوحة الغرف"); await openRoom(page, 603);
    await payOnBoard(page, { amount: 500 });
    await expect(toast(page)).toContainText("أكبر من المتبقي");
    await payOnBoard(page, { amount: -5 });
    await expect(toast(page)).toContainText("أكبر من صفر");
    await payOnBoard(page, { amount: 50, method: "تحويل بنكي / انستاباي" });
    await expect(toast(page)).toContainText("رقم التليفون");
    await payOnBoard(page, { amount: 50, method: "فيزا", last4: "99" });
    await expect(toast(page)).toContainText("آخر ٤ أرقام");
    expect(Number((await booking(env, "Validate Pay")).amount_paid)).toBe(0);
    expect(nonZero((await shift(env)).rows)).toHaveLength(0);
  });
});

test.describe("الحالة تلقائية (مفيش علامة متحصّل ولا فكة)", () => {
  test("الحالة بتتحرك لوحدها مع الدفع والرسوم والتمديد، ومفيش أي زرار أو علامة تحصيل في أي شاشة", async ({ page, env }) => {
    await users(env);
    await env.seedShift("ahmed");
    await env.seedBooking({ room: 604, guest: "Auto State", nights: 2, price: 100 });
    await page.goto("/"); await login(page, "ahmed");
    await goTab(page, "لوحة الغرف"); await openRoom(page, 604);
    const state = () => roomCard(page).getByTestId("pay-state");
    await expect(state()).toContainText("لسه مدفعش");
    await payOnBoard(page, { amount: 50 });
    await expect(state()).toContainText("دفع جزئي");
    await paidIs(env, "Auto State", 50);
    await payOnBoard(page);                                           // الباقي كله
    await paidIs(env, "Auto State", 200);
    await expect(state()).toContainText("مدفوع بالكامل");
    await expect(page.getByText(/مشغولة - متحصّلة 1/)).toBeVisible();
    // رسوم إضافية بعد الدفع الكامل: بتتحرك الحالة لوحدها لمتبقي من غير أي قفل
    await page.evaluate(() => document.querySelectorAll('[data-testid="booking-card"] details').forEach((d) => { d.open = true; }));
    await page.locator("xpath=//label[contains(.,'جولات')]/following-sibling::input").fill("40");
    await page.getByRole("button", { name: /حفظ الرسوم/ }).click();
    await expect(toast(page)).toContainText("تم حفظ الرسوم");
    await expect(state()).toContainText("دفع جزئي");
    await expect(page.getByText(/مشغولة - متبقي فلوس 1/)).toBeVisible();
    // تمديد ليلة: المتبقي بيزيد لوحده
    await page.getByRole("button", { name: /تمديد الحجز/ }).click();
    await expect(toast(page)).toContainText("تم تمديد الحجز");
    expect(digits(await roomCard(page).getByTestId("money-box").innerText())).toContain("140");
    const b = await booking(env, "Auto State");
    expect(b.settled).toBe(false);
    // مفيش أي نص تحصيل قديم في الشاشة
    const body = await page.locator("body").innerText();
    for (const gone of ["تعليم \"متحصّل", "إلغاء علامة", "متحصّل بالكامل - مقفول", "المبلغ المُستلم", "الفكة", "تم تحصيل كامل المبلغ"]) expect(body).not.toContain(gone);
    await goTab(page, "الحجوزات");
    const body2 = await page.locator("body").innerText();
    for (const gone of ["الفكة", "المبلغ المُستلم", "مُصفّى"]) expect(body2).not.toContain(gone);
    await page.getByRole("button", { name: /حجز جديد/ }).click();
    const form = await page.locator(".cx-card[data-calma-editing]").innerText();
    for (const gone of ["الفكة", "المبلغ المُستلم", "مُصفّى", "تم تحصيل كامل المبلغ"]) expect(form).not.toContain(gone);
  });

  test("حجز جديد بدفعة مقدّمة: الحالة والمتبقي من أول لحظة، وبوسيلته في اليومية (فودافون = اسم + رقم)", async ({ page, env }) => {
    await users(env);
    await page.goto("/"); await login(page, "ahmed");
    await claimShift(page);
    await addBooking(page, { room: 605, guest: "Advance Voda", price: 100, nights: 2, paid: 80, method: "فودافون كاش", senderName: "Karim", phone: "01099998888" });
    const b = await booking(env, "Advance Voda");
    expect(b).toMatchObject({ payment_method: "فودافون كاش", settled: false });
    expect(Number(b.amount_paid)).toBe(80);
    expect(b.payment_details).toMatchObject({ senderName: "Karim", senderNumber: "01099998888", ref: "" });
    const row = nonZero((await shift(env)).rows)[0];
    expect(row).toMatchObject({ collectionMethod: "فودافون كاش", collectionAmt: 80 });
    expect(row.paymentDetails).toMatchObject({ senderName: "Karim", senderNumber: "01099998888" });
    // دفع كامل وقت الحجز => الحجز متحصّل تلقائيًا
    await addBooking(page, { room: 606, guest: "Advance Full", price: 100, nights: 1, paid: 100, method: "فيزا", last4: "7777" });
    expect(await booking(env, "Advance Full")).toMatchObject({ settled: true });
    await goTab(page, "لوحة الغرف");
    await expect(page.getByText(/مشغولة - متحصّلة 1/)).toBeVisible();
    await expect(page.getByText(/مشغولة - متبقي فلوس 1/)).toBeVisible();
  });
});

test.describe("كافيتيريا النزلاء: بتتسجّل لوحدها في الكافيتيريا", () => {
  test("دفعة على حجز عليه كافيتيريا بتسدّد الكافيتيريا الأول وتروح لصف الكافيتيريا بنفس الوسيلة والتفاصيل", async ({ page, env }) => {
    await users(env);
    await env.seedShift("ahmed");
    const id = await env.seedBooking({ room: 607, guest: "Cafe Guest", nights: 1, price: 100, total: 100, extras: { laundry: 0, cafeteria: 50, tours: 0, pickup: 0 } });
    await page.goto("/"); await login(page, "ahmed");
    // اليومية بتبيّن إن على النزيل كافيتيريا لسه ماتحصّلتش
    await goTab(page, "اليومية");
    await expect(page.getByTestId("cafeteria-guest-due")).toContainText("Cafe Guest");
    await goTab(page, "لوحة الغرف"); await openRoom(page, 607);
    expect(digits(await roomCard(page).getByTestId("money-box").innerText())).toContain("150");
    await payOnBoard(page, { amount: 70, method: "فيزا", last4: "5555" });
    await expect(toast(page)).toContainText("منها 50 كافيتيريا".replace("50", "٥٠").replace(/٥٠/, "٥٠")).catch(async () => {
      expect(digits(await toast(page).innerText())).toContain("منها50كافيتيريا");
    });
    const b = await booking(env, "Cafe Guest");
    expect(Number(b.amount_paid)).toBe(70);
    expect(b.extras).toMatchObject({ cafeteria: 50, cafeteriaPaid: 50 });
    const rec = await shift(env);
    // ٥٠ كافيتيريا (فيزا ****5555) + ٢٠ على صف الغرفة (فيزا ****5555)
    expect(rec.cafeteria_rows).toHaveLength(1);
    expect(rec.cafeteria_rows[0]).toMatchObject({ kind: "guest", bookingId: id, collectionAmt: 50, collectionMethod: "فيزا", collectionCurrency: "USD" });
    expect(rec.cafeteria_rows[0].paymentDetails.senderNumber).toBe("5555");
    const roomRows = nonZero(rec.rows);
    expect(roomRows).toHaveLength(1);
    expect(roomRows[0]).toMatchObject({ room: 607, collectionAmt: 20, collectionMethod: "فيزا" });
    // مفيش حساب مرتين: مجموع الاتنين = ٧٠ = المدفوع
    expect(Number(rec.cafeteria_rows[0].collectionAmt) + Number(roomRows[0].collectionAmt)).toBe(70);
    // الباقي من الحجز (٨٠) كاش: كله لصف الغرفة (الكافيتيريا اتسدّدت خلاص)
    await payOnBoard(page, { method: "كاش" });
    await paidIs(env, "Cafe Guest", 150);
    await expect(toast(page)).toContainText("الحجز مدفوع بالكامل");
    const rec2 = await shift(env);
    expect(rec2.cafeteria_rows).toHaveLength(1);
    expect(Number(rec2.cafeteria_rows[0].collectionAmt)).toBe(50);
    expect(nonZero(rec2.rows).reduce((s, r) => s + Number(r.collectionAmt), 0)).toBe(100);

    // شاشة اليومية: قسم الكافيتيريا فيه صف النزيل بالفيزا وآخر ٤ أرقام، ومفيش "لسه ماتحصّلتش"
    await goTab(page, "اليومية");
    const sec = page.getByTestId("cafeteria-rows");
    await expect(sec).toContainText("Cafe Guest");
    await expect(sec).toContainText("****5555");
    await expect(page.getByTestId("cafeteria-guest-due")).toHaveCount(0);
    // عهدة الفيزا: ٧٠ (٥٠ كافيتيريا + ٢٠ غرفة)
    expect(digits(await page.getByTestId("method-transactions").innerText())).toContain("50");

    // التقرير: تحصيل الكافيتيريا من النزلاء ٥٠
    await logout(page); await login(page, "mona");
    await goTab(page, "التقارير");
    expect(digits(await page.getByTestId("report-cafeteria").innerText())).toContain("50$");
    // إجمالي التحصيل = ١٥٠ (٥٠ كافيتيريا + ١٠٠ غرفة) مش متكرر
    expect(digits(await page.locator(".cx-report-grid .cx-card", { hasText: "إجمالي التحصيل" }).first().innerText())).toContain("150$");
  });
});

test.describe("كافيتيريا الاستاف: مين أخد ومين دفع ومين عليه فلوس", () => {
  async function openLedger(page) {
    await goTab(page, "اليومية");
    await expect(page.getByTestId("staff-cafe-form")).toBeVisible();
  }
  const addStaff = async (page, { who, desc, amount, mode, last4, name, phone, manual }) => {
    await page.getByTestId("staff-cafe-who").selectOption(who);
    if (manual) await page.getByTestId("staff-cafe-manual").fill(manual);
    if (desc) await page.getByTestId("staff-cafe-desc").fill(desc);
    await page.getByTestId("staff-cafe-amount").fill(String(amount));
    if (mode) await page.getByTestId("staff-cafe-paymode").selectOption(mode);
    if (last4) await page.getByTestId("staff-cafe-last4").fill(last4);
    if (name) await page.getByTestId("staff-cafe-name").fill(name);
    if (phone) await page.getByTestId("staff-cafe-phone").fill(phone);
    await page.getByTestId("staff-cafe-add").click();
    await waitIdle(page);
  };

  test("استهلاك آجل: بيبان عليه فلوس (في اليومية والتقرير) وبيفضل لحد ما يسدّد - والسداد بيدخل الكافيتيريا بالوسيلة", async ({ page, env }) => {
    await users(env);
    await page.goto("/"); await login(page, "ahmed");
    await claimShift(page);
    await openLedger(page);
    // سارة أخدت قهوة ولسه مادفعتش
    await addStaff(page, { who: "sara", desc: "قهوة وساندوتش", amount: 60, mode: "later" });
    await expect(toast(page)).toContainText("عليه");
    const [e1] = await env.q("select * from staff_cafeteria");
    expect(e1).toMatchObject({ consumer_username: "sara", consumer_name: "سارة", description: "قهوة وساندوتش", currency: "EGP", recorded_by: "ahmed" });
    expect(Number(e1.amount)).toBe(60); expect(Number(e1.paid_amount)).toBe(0);
    // مفيش حاجة دخلت اليومية (الاستهلاك مش فلوس دخلت)
    expect((await shift(env)).cafeteria_rows).toHaveLength(0);
    const bal = page.getByTestId("staff-cafe-balance");
    await expect(bal).toContainText("سارة");
    expect(digits(await bal.innerText())).toContain("60EGP");
    // استهلاك تاني لنفس الموظفة + استاف بالاسم اليدوي
    await addStaff(page, { who: "sara", desc: "عصير", amount: 15, mode: "later" });
    await addStaff(page, { who: "__manual__", manual: "عم حسن", desc: "شاي", amount: 10, mode: "later" });
    await expect(page.getByTestId("staff-cafe-balance")).toHaveCount(2);
    await expect.poll(async () => digits(await page.getByTestId("staff-cafe-balances").innerText())).toContain("75EGP");

    // سداد جزئي بالفيزا (٤٠ من ٧٥): بيتوزّع على الأقدم، وبيدخل صف الكافيتيريا في اليومية بآخر ٤ أرقام
    const saraRow = page.getByTestId("staff-cafe-balance").filter({ hasText: "سارة" });
    await saraRow.getByTestId("staff-cafe-settle-open").click();
    await page.getByTestId("staff-cafe-pay-amount").fill("40");
    await page.getByTestId("staff-cafe-pay-method").selectOption("فيزا");
    await page.getByTestId("staff-cafe-pay-last4").fill("3333");
    await page.getByTestId("staff-cafe-pay-go").click();
    await waitIdle(page);
    await expect(toast(page)).toContainText("لسه عليه");
    const entries = await env.q("select consumer_name, amount, paid_amount from staff_cafeteria order by created_at");
    expect(entries.map((e) => [e.consumer_name, Number(e.amount), Number(e.paid_amount)])).toEqual([["سارة", 60, 40], ["سارة", 15, 0], ["عم حسن", 10, 0]]);
    const rec = await shift(env);
    expect(rec.cafeteria_rows).toHaveLength(1);
    expect(rec.cafeteria_rows[0]).toMatchObject({ kind: "staff", who: "سارة", collectionAmt: 40, collectionMethod: "فيزا", collectionCurrency: "EGP" });
    expect(rec.cafeteria_rows[0].paymentDetails.senderNumber).toBe("3333");
    await expect(page.getByTestId("cafeteria-rows")).toContainText("****3333");
    await expect(page.getByTestId("cafeteria-rows")).toContainText("استاف");
    // سارة لسه عليها ٣٥ (٢٠ + ١٥)
    await expect.poll(async () => digits(await page.getByTestId("staff-cafe-balance").filter({ hasText: "سارة" }).innerText())).toContain("35EGP");

    // سداد الباقي كاش: سارة تتشال من قايمة اللي عليهم فلوس، وعم حسن لسه
    await page.getByTestId("staff-cafe-balance").filter({ hasText: "سارة" }).getByTestId("staff-cafe-settle-open").click();
    await page.getByTestId("staff-cafe-pay-method").selectOption("كاش");
    await page.getByTestId("staff-cafe-pay-go").click();
    await waitIdle(page);               // المبلغ فاضي = كل اللي عليها
    await expect(toast(page)).toContainText("مفيش عليه حاجة");
    await expect(page.getByTestId("staff-cafe-balance")).toHaveCount(1);
    await expect(page.getByTestId("staff-cafe-balance")).toContainText("عم حسن");
    const rec2 = await shift(env);
    const cash = rec2.cafeteria_rows.find((r) => r.collectionMethod === "كاش");
    expect(cash).toMatchObject({ kind: "staff", who: "سارة", collectionAmt: 35 });
    // إجمالي التحصيل في اليومية = ٧٥ جنيه (٤٠ فيزا + ٣٥ كاش)، ورصيد الكاش ٣٥
    const closedTotals = await page.locator(".cx-card", { hasText: "رصيد الخزينة" }).last().innerText();
    expect(digits(closedTotals)).toContain("75");
    // سداد أكتر من المديونية مرفوض
    await page.getByTestId("staff-cafe-balance").first().getByTestId("staff-cafe-settle-open").click();
    await page.getByTestId("staff-cafe-pay-amount").fill("500");
    await page.getByTestId("staff-cafe-pay-go").click();
    await waitIdle(page);
    await expect(toast(page)).toContainText("أكبر من المديونية");

    // مدير الحسابات: يشوف المديونية في التقرير (عم حسن عليه ١٠) وتحصيل الاستاف ٧٥
    await logout(page); await login(page, "mona");
    await goTab(page, "التقارير");
    const owed = page.getByTestId("report-staff-owed");
    await expect(owed).toContainText("عم حسن");
    expect(digits(await owed.innerText())).toContain("10EGP");
    await expect(owed).not.toContainText("سارة");
    expect(digits(await page.getByTestId("report-cafeteria").innerText())).toContain("75ج");
    // وفي اليومية (قراءة بس): من غير أي خانات تسجيل
    await goTab(page, "اليومية");
    await page.getByRole("button", { name: /استعراض شيفتات سابقة/ }).click();
    await expect(page.getByTestId("staff-cafe-form")).toHaveCount(0);
  });

  test("استهلاك مدفوع فورًا (كاش وفيزا): بيدخل الكافيتيريا في اليومية ومفيش مديونية", async ({ page, env }) => {
    await users(env);
    await page.goto("/"); await login(page, "ahmed");
    await claimShift(page);
    await openLedger(page);
    await addStaff(page, { who: "sara", desc: "شاي", amount: 12, mode: "كاش" });
    await expect(toast(page)).toContainText("تم تسجيل الاستهلاك والسداد");
    await addStaff(page, { who: "sara", desc: "وجبة", amount: 90, mode: "فيزا", last4: "8888" });
    await expect(toast(page)).toContainText("تم تسجيل الاستهلاك والسداد");
    // فيزا من غير ٤ أرقام مرفوضة وماتسجّلتش
    await addStaff(page, { who: "sara", desc: "x", amount: 5, mode: "فيزا" });
    await expect(toast(page)).toContainText("آخر ٤ أرقام");
    const es = await env.q("select amount, paid_amount, payments from staff_cafeteria order by created_at");
    expect(es).toHaveLength(2);
    expect(es.map((e) => [Number(e.amount), Number(e.paid_amount)])).toEqual([[12, 12], [90, 90]]);
    expect(es[1].payments[0]).toMatchObject({ amount: 90, method: "فيزا" });
    expect(es[1].payments[0].details.senderNumber).toBe("8888");
    await expect(page.getByTestId("staff-cafe-balance")).toHaveCount(0);
    const rec = await shift(env);
    expect(rec.cafeteria_rows.map((r) => `${r.collectionMethod}:${r.collectionAmt}`).sort()).toEqual(["فيزا:90", "كاش:12"].sort());
    // عهدة الفيزا فيها ٩٠ بتفاصيلها
    await expect(page.getByTestId("method-transactions")).toContainText("****8888");
    // إقفال الشيفت بيحفظ الإجماليات شاملة الكافيتيريا
    await page.getByRole("button", { name: /إقفال الشيفت/ }).click();
    await expect(page.getByText(/أُقفل بواسطة/)).toBeVisible();
    const closed = await shift(env);
    expect(closed.total_collections).toEqual({ EGP: 102 });
    expect(closed.cash_collections).toEqual({ EGP: 12 });
    expect(closed.by_method_currency["فيزا"]).toEqual({ EGP: 90 });
    expect(closed.closing_cash).toEqual({ EGP: 12 });
  });

  test("الصلاحيات: مدير الحجوزات والحسابات والمدير العام مايكتبوش، والموظف مايعدّلش مبلغ استهلاك ومايمسحش، والمدير العام بيصحّح", async ({ page, env }) => {
    await users(env);
    await env.seedShift("ahmed");
    await page.goto("/"); await login(page, "ahmed");
    await openLedger(page);
    await addStaff(page, { who: "sara", desc: "قهوة", amount: 30, mode: "later" });
    await expect(toast(page)).toContainText("عليه");
    const [e] = await env.q("select id from staff_cafeteria");
    const asDb = (u, m, p, b) => env.api(u, m, p, b);
    const denied = (r) => r.status >= 400 || (Array.isArray(r.body) && r.body.length === 0);
    // الموظف: مايغيّرش المبلغ ولا الاسم ولا يقلّل المدفوع ولا يمسح
    expect(denied(await asDb("ahmed", "PATCH", `/rest/v1/staff_cafeteria?id=eq.${e.id}`, { amount: 1 }))).toBe(true);
    expect(denied(await asDb("ahmed", "PATCH", `/rest/v1/staff_cafeteria?id=eq.${e.id}`, { consumer_name: "حد تاني" }))).toBe(true);
    expect(denied(await asDb("ahmed", "DELETE", `/rest/v1/staff_cafeteria?id=eq.${e.id}`))).toBe(true);
    expect(Number((await env.q("select amount from staff_cafeteria"))[0].amount)).toBe(30);
    // السداد بالـ API المباشر ممنوع على أي موظف (قسم ٣٥): بيتسدّد من settle_staff_cafeteria بس (من اليومية)
    for (const v of [999, 10, 5]) expect(denied(await asDb("ahmed", "PATCH", `/rest/v1/staff_cafeteria?id=eq.${e.id}`, { paid_amount: v }))).toBe(true);
    expect(Number((await env.q("select paid_amount from staff_cafeteria"))[0].paid_amount)).toBe(0);
    expect(denied(await asDb("ahmed", "POST", "/rest/v1/staff_cafeteria", { consumer_name: "x", amount: 5, paid_amount: 5, currency: "EGP" }))).toBe(true);
    // مدير الحجوزات / الحسابات: قراءة بس (مفيش إضافة ولا تعديل)
    for (const u of ["rawan", "mona"]) {
      const ins = await asDb(u, "POST", "/rest/v1/staff_cafeteria", { consumer_name: "x", amount: 5, currency: "EGP" });
      expect(ins.status, `${u} insert`).toBeGreaterThanOrEqual(400);
      const sel = await asDb(u, "GET", "/rest/v1/staff_cafeteria?select=id");
      expect(sel.body).toHaveLength(1);
    }
    // المبلغ مقفول بالـ API حتى على الحسابات (التصحيح من محرر SQL)، لكن الوصف مش فلوس والحسابات تقدر تعدّله؛ والمدير العام يمسح
    expect(denied(await asDb("mona", "PATCH", `/rest/v1/staff_cafeteria?id=eq.${e.id}`, { amount: 25 }))).toBe(true);
    expect(Number((await env.q("select amount from staff_cafeteria"))[0].amount)).toBe(30);
    expect(denied(await asDb("mona", "PATCH", `/rest/v1/staff_cafeteria?id=eq.${e.id}`, { description: "قهوة وكيك" }))).toBe(false);
    expect(denied(await asDb("boss", "DELETE", `/rest/v1/staff_cafeteria?id=eq.${e.id}`))).toBe(false);
    expect(await env.q("select 1 from staff_cafeteria")).toHaveLength(0);
    // قيم غلط ممنوعة من القاعدة نفسها (مبلغ صفر/سالب، عملة غريبة)
    for (const bad of [{ amount: 0 }, { amount: -5 }, { amount: 5, currency: "XYZ" }]) {
      const r = await asDb("ahmed", "POST", "/rest/v1/staff_cafeteria", { consumer_name: "x", currency: "EGP", ...bad });
      expect(r.status, JSON.stringify(bad)).toBeGreaterThanOrEqual(400);
    }
    // واجهة مدير الحجوزات: قسم الكافيتيريا للعرض بس
    await logout(page); await login(page, "rawan");
    await goTab(page, "اليومية");
    await page.getByRole("button", { name: /استعراض شيفتات سابقة/ }).click();
    await expect(page.getByTestId("staff-cafe-form")).toHaveCount(0);
  });
});
