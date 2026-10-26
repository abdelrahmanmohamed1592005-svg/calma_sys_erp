// دورة حياة الفلوس من الشاشات فوق قاعدة بيانات حقيقية: تحصيل، رسوم إضافية، تمديد،
// إلغاء، طلب رد الفلوس وقراره - ومتابعة الأثر على الحجز واليومية ولوحة الغرف والتقرير.
import { test, expect } from "../fixtures";
import { login, logout, goTab, field, boardTile, roomCard, toast, refresh, digits, cairoDate, addBooking, openRoom, openMore, payOnBoard, addExtraOnBoard } from "../ui";

async function users(env) {
  await env.seedUser("boss", "gm", "المدير");
  await env.seedUser("ahmed", "staff", "أحمد");
  await env.seedUser("rawan", "reservations", "روان");
  await env.seedUser("mona", "accounts", "منى");
}
const ledgerRows = async (env, room) => {
  const [rec] = await env.q("select rows, booking_collections from shift_records order by date desc limit 1");
  return { rows: rec.rows.filter((r) => r.room === room && Number(r.collectionAmt) !== 0), all: rec.rows, bc: rec.booking_collections };
};
const sumLedger = async (env, cur = "USD") => {
  const recs = await env.q("select rows from shift_records");
  return recs.reduce((s, r) => s + r.rows.filter((x) => x.collectionCurrency === cur).reduce((a, x) => a + (Number(x.collectionAmt) || 0), 0), 0);
};
const collectOnBoard = async (page, room, method) => {
  await goTab(page, "لوحة الغرف");
  await openRoom(page, room);
  const card = roomCard(page);
  const transfer = method && method !== "كاش" && method !== "فيزا";
  await payOnBoard(page, { method, last4: method === "فيزا" ? "1234" : undefined, senderName: transfer ? "Sender" : undefined, phone: transfer ? "01012345678" : undefined });
  await expect(toast(page)).toContainText("الحجز مدفوع بالكامل");
};

test.describe("رسوم إضافية وتجميع التحصيل", () => {
  test("تحصيل ثم رسوم إضافية ثم تحصيل الفرق: الحالة تلقائية، وصف اليومية بيتجمّع", async ({ page, env }) => {
    await users(env);
    await env.seedShift("ahmed");
    const id = await env.seedBooking({ room: 602, guest: "Extras Guest", nights: 2, price: 100 });
    await page.goto("/");
    await login(page, "ahmed");

    await collectOnBoard(page, 602);
    let [b] = await env.q("select * from bookings where id = $1", [id]);
    expect(b).toMatchObject({ amount_paid: 200, settled: true });
    // الحالة "مدفوع بالكامل" تلقائية - مفيش علامة ولا زرار تعليم/إلغاء، ومفيش قفل على الرسوم
    await expect(roomCard(page).getByTestId("pay-state")).toContainText("مدفوع بالكامل");
    await expect(roomCard(page)).not.toContainText("مقفول");
    await expect(page.getByRole("button", { name: /إلغاء علامة|تعليم/ })).toHaveCount(0);
    await expect(page.getByTestId("pay-record")).toHaveCount(0);       // مفيش متبقي = مفيش تحصيل

    await addExtraOnBoard(page, "جولات", 30);
    await expect(toast(page)).toContainText("اتضاف جولات 30 USD");
    [b] = await env.q("select * from bookings where id = $1", [id]);
    expect(b.extras).toMatchObject({ tours: 30 });
    expect(b.settled).toBe(false);                                       // الحالة اتحدّثت لوحدها لمتبقي
    await expect(roomCard(page).getByTestId("pay-state")).toContainText("دفع جزئي");
    expect(digits(await roomCard(page).innerText())).toMatch(/المتبقي30USD/);
    await expect(page.getByText(/مشغولة - متبقي فلوس 1/)).toBeVisible();

    await payOnBoard(page);
    await expect(toast(page)).toContainText("الحجز مدفوع بالكامل");
    [b] = await env.q("select * from bookings where id = $1", [id]);
    expect(b).toMatchObject({ amount_paid: 230, settled: true });
    const { rows, bc } = await ledgerRows(env, 602);
    expect(rows).toHaveLength(1);                       // نفس الوسيلة والعملة: اتجمّعوا في صف واحد
    expect(Number(rows[0].collectionAmt)).toBe(230);
    expect(bc).toHaveLength(2);
    expect(await sumLedger(env)).toBe(230);
  });

  test("تحصيل بوسيلة تانية على نفس الغرفة بيعمل صف إضافي في اليومية (مش بيخلط الوسائل)", async ({ page, env }) => {
    await users(env);
    await env.seedShift("ahmed");
    const id = await env.seedBooking({ room: 605, guest: "Mixed Methods", nights: 1, price: 100, paid: 40, method: "كاش" });
    // جزء اتحصّل كاش قبل كده في اليومية
    await env.q("update shift_records set rows = (select jsonb_agg(case when r->>'room' = '605' then r || '{\"collectionAmt\":40,\"collectionMethod\":\"كاش\",\"collectionCurrency\":\"USD\",\"collectionDesc\":\"مقدّم\"}'::jsonb else r end) from jsonb_array_elements(rows) r), booking_collections = jsonb_build_array(jsonb_build_object('id','x','bookingId',$1::text))", [id]);
    await page.goto("/");
    await login(page, "ahmed");
    await collectOnBoard(page, 605, "فيزا");               // تحصيل الباقي (60) بفيزا
    const [b] = await env.q("select * from bookings where id = $1", [id]);
    expect(b).toMatchObject({ amount_paid: 100, settled: true, payment_method: "فيزا" });
    const { rows } = await ledgerRows(env, 605);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => [r.collectionMethod, Number(r.collectionAmt)]).sort()).toEqual([["فيزا", 60], ["كاش", 40]].sort());
    expect(await sumLedger(env)).toBe(100);
  });
});

test.describe("التمديد من لوحة الغرف", () => {
  test("تمديد حجز متحصّل: علامة متحصّل بتتشال والمتبقي بيظهر، والتحصيل بعده بيقفل", async ({ page, env }) => {
    await users(env);
    await env.seedShift("ahmed");
    const id = await env.seedBooking({ room: 603, guest: "Stay Longer", nights: 1, price: 100, paid: 100, settled: true });
    await page.goto("/");
    await login(page, "ahmed");
    await goTab(page, "لوحة الغرف");
    await openRoom(page, 603);
    await roomCard(page).getByRole("button", { name: /تمديد الحجز/ }).click();
    await expect(toast(page)).toContainText("تم تمديد الحجز");
    let [b] = await env.q("select * from bookings where id = $1", [id]);
    expect(b).toMatchObject({ total_room: 200, amount_paid: 100, settled: false, checkout: cairoDate(2) });
    await expect(page.getByText(/مشغولة - متبقي فلوس 1/)).toBeVisible();
    await payOnBoard(page);
    await expect(toast(page)).toContainText("الحجز مدفوع بالكامل");
    [b] = await env.q("select * from bookings where id = $1", [id]);
    expect(b).toMatchObject({ amount_paid: 200, settled: true });
    const { rows } = await ledgerRows(env, 603);
    expect(rows.map((r) => Number(r.collectionAmt))).toEqual([100]);   // فرق الليلة الإضافية فقط اتسجّل النهارده
  });

  test("تمديد فوق حجز تاني مرفوض وبرسالة واضحة لو الحجز التاني من مدير الحجوزات", async ({ page, env }) => {
    await users(env);
    await env.seedShift("ahmed");
    const id = await env.seedBooking({ room: 606, guest: "Blocked", nights: 1, price: 100 });
    await env.seedBooking({ room: 606, guest: "Next Guest", start: 1, nights: 2, by: "rawan", role: "reservations" });
    await page.goto("/");
    await login(page, "ahmed");
    await goTab(page, "لوحة الغرف");
    await openRoom(page, 606);
    await roomCard(page).getByRole("button", { name: /تمديد الحجز/ }).click();
    await expect(toast(page)).toContainText("مدير الحجوزات ضايف حجز على الغرفة دي");
    const [b] = await env.q("select * from bookings where id = $1", [id]);
    expect(b.checkout).toBe(cairoDate(1));
  });
});

test.describe("الإلغاء: مفيش رد فلوس - المتحصّل بيفضل في الفندق", () => {
  async function seedPaidBooking(env, o = {}) {
    const id = await env.seedBooking({ room: 604, guest: "Cancel Guest", nights: 3, price: 100, paid: 300, settled: true, ...o });
    return id;
  }

  test("مدير الحجوزات يلغي حجز مدفوع: الفلوس بتفضل في الفندق، مفيش طلب رد ولا أزرار رد، والتقرير بيعدّها", async ({ page, env }) => {
    await users(env);
    const id = await seedPaidBooking(env);
    await env.seedShift("ahmed", { collections: [{ room: 604, amount: 300, method: "كاش", currency: "USD", bookingId: id }] });
    await page.goto("/");
    await login(page, "rawan");

    await goTab(page, "الحجوزات");
    await page.locator(".cx-card", { hasText: "Cancel Guest" }).last().locator("button").first().click();
    await openMore(page);
    await page.locator("xpath=//label[contains(.,'الحالة')]/following-sibling::select").selectOption("ملغي");
    await expect(page.getByText(/بعد الإلغاء الفلوس دي بتفضل في الفندق \(مفيش رد فلوس\)/)).toBeVisible();
    await page.getByRole("button", { name: /حفظ الحجز/ }).click();
    await expect(toast(page)).toContainText("فضلت في الفندق");
    const [b] = await env.q("select * from bookings where id = $1", [id]);
    expect(b).toMatchObject({ status: "ملغي", refund_pending: false, refund_decision: null, amount_paid: 300 });
    await expect(page.getByTestId("refund-status")).toContainText("فضلت في الفندق");
    await expect(page.getByTestId("booking-cancelled")).toContainText("حجز ملغي");
    await expect(page.getByRole("button", { name: /رد الفلوس|رفض الرد/ })).toHaveCount(0);

    await goTab(page, "لوحة الغرف");
    await expect(page.getByTestId("refund-banner")).toHaveCount(0);
    await expect(page.getByText(/متاحة 16/)).toBeVisible();
    expect(await sumLedger(env)).toBe(300);                        // اليومية ما اتلمستش

    await goTab(page, "التقارير");
    await expect(page.getByText(/طلبات رد فلوس/)).toHaveCount(0);
    const totalCard = page.locator(".cx-report-grid .cx-card", { hasText: "إجمالي التحصيل" }).first();
    expect(digits(await totalCard.innerText())).toContain("التحصيل300$");
    await logout(page);

    await login(page, "ahmed");
    await goTab(page, "الحجوزات");
    await expect(page.getByTestId("refund-status")).toContainText("فضلت في الفندق");
    await expect(page.getByRole("button", { name: /رد الفلوس/ })).toHaveCount(0);
  });

  test("تقصير الإقامة من مدير الحجوزات: الإجمالي بيتحرك تلقائي والزيادة المدفوعة بتفضل في الفندق", async ({ page, env }) => {
    await users(env);
    const id = await seedPaidBooking(env, { room: 610, guest: "Shorten Me", start: -1, nights: 4, price: 100, paid: 400 });
    await env.seedShift("ahmed", { collections: [{ room: 610, amount: 400, method: "كاش", currency: "USD", bookingId: id }] });
    await page.goto("/");
    await login(page, "rawan");
    await goTab(page, "الحجوزات");
    await page.locator(".cx-card", { hasText: "Shorten Me" }).last().locator("button").first().click();
    await field(page, "تاريخ الخروج").fill(cairoDate(1));            // 2 ليالي بدل 4
    await expect(page.getByText(/إجمالي الغرفة اتحرك تلقائيًا/)).toBeVisible();
    await page.getByRole("button", { name: /حفظ الحجز/ }).click();
    await expect(toast(page)).toBeVisible();
    await expect(page.getByTestId("refund-request")).toHaveCount(0);
    const [b] = await env.q("select * from bookings where id = $1", [id]);
    expect(b).toMatchObject({ total_room: 200, amount_paid: 400, refund_pending: false, settled: true, checkout: cairoDate(1) });
    expect(await sumLedger(env)).toBe(400);
  });
});

