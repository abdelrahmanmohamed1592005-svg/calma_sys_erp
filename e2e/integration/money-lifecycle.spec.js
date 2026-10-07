// دورة حياة الفلوس من الشاشات فوق قاعدة بيانات حقيقية: تحصيل، رسوم إضافية، تمديد،
// إلغاء، طلب رد الفلوس وقراره - ومتابعة الأثر على الحجز واليومية ولوحة الغرف والتقرير.
import { test, expect } from "../fixtures";
import { login, logout, goTab, field, boardTile, roomCard, toast, refresh, digits, cairoDate, addBooking, openRoom, openMore } from "../ui";

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
  if (method) await card.getByTestId("collect-method").selectOption(method);
  await card.getByRole("button", { name: /تسجيل تحصيل كامل المبلغ/ }).click();
  await expect(toast(page)).toContainText("تم تسجيل التحصيل الكامل");
};

test.describe("رسوم إضافية وتجميع التحصيل", () => {
  test("تحصيل ثم إلغاء العلامة ثم رسوم إضافية ثم تحصيل الفرق: صف اليومية بيتجمّع", async ({ page, env }) => {
    await users(env);
    await env.seedShift("ahmed");
    const id = await env.seedBooking({ room: 602, guest: "Extras Guest", nights: 2, price: 100 });
    await page.goto("/");
    await login(page, "ahmed");

    await collectOnBoard(page, 602);
    let [b] = await env.q("select * from bookings where id = $1", [id]);
    expect(b).toMatchObject({ amount_paid: 200, settled: true });
    await expect(roomCard(page)).toContainText("متحصّل بالكامل - مقفول");
    // الرسوم الإضافية مقفولة والفورم مش ظاهر
    await expect(page.getByRole("button", { name: /حفظ الرسوم/ })).toHaveCount(0);

    await roomCard(page).getByRole("button", { name: /إلغاء علامة/ }).click();
    await expect(toast(page)).toContainText("تم إلغاء علامة التحصيل");
    [b] = await env.q("select * from bookings where id = $1", [id]);
    expect(b).toMatchObject({ settled: false, amount_paid: 200 });

    await field(page, "جولات").fill("30");
    await page.getByRole("button", { name: /حفظ الرسوم/ }).click();
    await expect(toast(page)).toContainText("تم حفظ الرسوم الإضافية");
    [b] = await env.q("select * from bookings where id = $1", [id]);
    expect(b.extras).toMatchObject({ tours: 30 });
    await expect(roomCard(page)).toContainText(/المتبقي/);
    expect(digits(await roomCard(page).innerText())).toMatch(/المتبقي30USD/);
    await expect(page.getByText(/مشغولة - متبقي فلوس 1/)).toBeVisible();

    await roomCard(page).getByRole("button", { name: /تسجيل تحصيل كامل المبلغ/ }).click();
    await expect(toast(page)).toContainText("تم تسجيل التحصيل الكامل");
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
    await collectOnBoard(page, 605, "فيزا");               // تحصيل الباقي (٦٠) بفيزا
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
    await roomCard(page).getByRole("button", { name: /تسجيل تحصيل كامل المبلغ/ }).click();
    await expect(toast(page)).toContainText("تم تسجيل التحصيل الكامل");
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

test.describe("الإلغاء وطلب رد الفلوس", () => {
  async function seedPaidBooking(env, o = {}) {
    const id = await env.seedBooking({ room: 604, guest: "Refund Guest", nights: 3, price: 100, paid: 300, settled: true, ...o });
    return id;
  }

  test("مدير الحجوزات يلغي حجز مدفوع → طلب رد → الموظف يشوفه → المدير يرد → اليومية والتقرير", async ({ page, env }) => {
    await users(env);
    const id = await seedPaidBooking(env);
    await env.seedShift("ahmed", { collections: [{ room: 604, amount: 300, method: "كاش", currency: "USD", bookingId: id }] });
    await page.goto("/");
    await login(page, "rawan");

    // إلغاء الحجز من شاشة التعديل
    await goTab(page, "الحجوزات");
    await page.locator(".cx-card", { hasText: "Refund Guest" }).last().locator("button").first().click();
    await openMore(page);
    await page.locator("xpath=//label[contains(.,'الحالة')]/following-sibling::select").selectOption("ملغي");
    await expect(page.getByText(/متحصّل - بعد الإلغاء هيتفتح طلب رد فلوس/)).toBeVisible();
    await page.getByRole("button", { name: /حفظ الحجز/ }).click();
    await expect(toast(page)).toContainText("طلب رد فلوس");
    let [b] = await env.q("select * from bookings where id = $1", [id]);
    expect(b).toMatchObject({ status: "ملغي", refund_pending: true, amount_paid: 300 });
    await goTab(page, "لوحة الغرف");          // الشريط بيظهر في كل التابات ماعدا الحجوزات (القايمة نفسها فيها الطلب)
    await expect(page.getByTestId("refund-banner")).toContainText("طلبات رد فلوس منتظرة (1)");
    await expect(tabBadge(page)).toContainText("1");

    // لوحة الغرف: الغرفة رجعت متاحة
    await goTab(page, "لوحة الغرف");
    await expect(page.getByText(/متاحة 16/)).toBeVisible();

    // التقرير بيعرض الطلب المعلّق
    await goTab(page, "التقارير");
    await expect(page.getByText(/طلبات رد فلوس منتظرة قرار مدير الحجوزات \(1\)/)).toBeVisible();
    expect(digits(await page.locator(".cx-card", { hasText: "طلبات رد فلوس منتظرة" }).last().innerText())).toContain("300USD");
    await logout(page);

    // الموظف: بيشوف الطلب من غير أزرار قرار
    await login(page, "ahmed");
    await goTab(page, "الحجوزات");
    await expect(page.getByTestId("refund-request")).toContainText("في انتظار موافقة مدير الحجوزات");
    await expect(page.getByRole("button", { name: "رد الفلوس" })).toHaveCount(0);
    await logout(page);

    // مدير الحجوزات يرد
    await login(page, "rawan");
    await goTab(page, "الحجوزات");
    const req = page.getByTestId("refund-request");
    await req.getByRole("button", { name: "رد الفلوس" }).click();
    await expect(toast(page)).toContainText("تم رد");
    [b] = await env.q("select * from bookings where id = $1", [id]);
    expect(b).toMatchObject({ amount_paid: 0, settled: false, refund_pending: false, refund_decision: "refunded", refunded_amount: 300, refunded_by: "rawan" });
    const { all, bc } = await ledgerRows(env, 604);
    expect(Number(all.find((r) => r.room === 604).collectionAmt)).toBe(0);     // ٣٠٠ - ٣٠٠
    expect(bc).toHaveLength(2);
    expect(await sumLedger(env)).toBe(0);
    await expect(page.getByTestId("refund-banner")).toHaveCount(0);
    await expect(page.getByTestId("refund-status")).toContainText("اترد للنزيل");
    await expect(page.getByTestId("booking-cancelled")).toContainText("حجز ملغي");      // الحجز الملغي بيفضل ظاهر بعد الرد

    await goTab(page, "التقارير");
    await expect(page.getByText(/طلبات رد فلوس منتظرة/)).toHaveCount(0);
    const totalCard = page.locator(".cx-report-grid .cx-card", { hasText: "إجمالي التحصيل" }).first();
    expect(digits(await totalCard.innerText())).toMatch(/التحصيل0$/);
  });

  test("رفض الرد: الفلوس تفضل متحصّلة وتظهر في التقرير", async ({ page, env }) => {
    await users(env);
    const id = await seedPaidBooking(env, { room: 607, guest: "Keep Guest", nights: 2, price: 100, paid: 200, method: "فيزا" });
    await env.seedShift("ahmed");     // اليومية فاضية: التحصيل ده اتسجّل على الحجز بس (مفيش journal)
    await page.goto("/");
    await login(page, "rawan");
    await goTab(page, "الحجوزات");
    await page.locator(".cx-card", { hasText: "Keep Guest" }).last().locator("button").first().click();
    await openMore(page);
    await page.locator("xpath=//label[contains(.,'الحالة')]/following-sibling::select").selectOption("ملغي");
    await page.getByRole("button", { name: /حفظ الحجز/ }).click();
    await expect(toast(page)).toContainText("طلب رد فلوس");
    const req = page.getByTestId("refund-request");
    await req.getByRole("button", { name: /رفض الرد/ }).click();
    await expect(toast(page)).toContainText("تم رفض الرد");
    const [b] = await env.q("select * from bookings where id = $1", [id]);
    expect(b).toMatchObject({ status: "ملغي", refund_pending: false, refund_decision: "kept", amount_paid: 200 });
    await expect(page.getByTestId("refund-status")).toContainText("رُفض الرد");
    expect(await sumLedger(env)).toBe(0);                // مفيش حاجة اتخصمت من اليومية
    await goTab(page, "التقارير");
    const visaRow = page.locator("table.cx-table tr", { hasText: "فيزا" }).first();
    expect(digits(await visaRow.innerText())).toContain("200");        // التحصيل المحتفظ بيه ظاهر في التقرير
  });

  test("رد الفلوس بوسيلة دفع مختلفة بيسجّل صف جديد في اليومية", async ({ page, env }) => {
    await users(env);
    const id = await seedPaidBooking(env, { room: 608, guest: "Method Guest", nights: 1, price: 100, paid: 100, method: "فيزا" });
    await env.seedShift("ahmed", { collections: [{ room: 608, amount: 100, method: "فيزا", currency: "USD", bookingId: id }] });
    await env.q("update bookings set status = 'ملغي' where id = $1", [id]);
    await page.goto("/");
    await login(page, "rawan");
    await goTab(page, "الحجوزات");
    const req = page.getByTestId("refund-request");
    await req.locator("select.cx-select").selectOption("كاش");
    await req.getByRole("button", { name: "رد الفلوس" }).click();
    await expect(toast(page)).toContainText("تم رد");
    const { rows } = await ledgerRows(env, 608);
    expect(rows.map((r) => [r.collectionMethod, Number(r.collectionAmt)]).sort()).toEqual([["كاش", -100], ["فيزا", 100]].sort());
  });

  test("مفيش شيفت مفتوح: الرد بيترفض ومفيش حاجة بتتغيّر", async ({ page, env }) => {
    await users(env);
    const id = await seedPaidBooking(env, { room: 609, guest: "No Shift", nights: 1, price: 100, paid: 100 });
    await env.seedShift("ahmed", { closed: true });
    await env.q("update bookings set status = 'ملغي' where id = $1", [id]);
    await page.goto("/");
    await login(page, "rawan");
    await goTab(page, "الحجوزات");
    const req = page.getByTestId("refund-request");
    await req.getByRole("button", { name: "رد الفلوس" }).click();
    await expect(toast(page)).toContainText("مفيش شيفت مفتوح");
    const [b] = await env.q("select * from bookings where id = $1", [id]);
    expect(b).toMatchObject({ refund_pending: true, amount_paid: 100 });
  });

  test("تقصير الإقامة من مدير الحجوزات: الإجمالي بيتحرك تلقائي وطلب رد للزيادة", async ({ page, env }) => {
    await users(env);
    const id = await seedPaidBooking(env, { room: 610, guest: "Shorten Me", start: -1, nights: 4, price: 100, paid: 400 });
    await env.seedShift("ahmed", { collections: [{ room: 610, amount: 400, method: "كاش", currency: "USD", bookingId: id }] });
    await page.goto("/");
    await login(page, "rawan");
    await goTab(page, "الحجوزات");
    await page.locator(".cx-card", { hasText: "Shorten Me" }).last().locator("button").first().click();
    await field(page, "تاريخ الخروج").fill(cairoDate(1));            // ٢ ليالي بدل ٤
    await expect(page.getByText(/إجمالي الغرفة اتحرك تلقائيًا/)).toBeVisible();
    await page.getByRole("button", { name: /حفظ الحجز/ }).click();
    await expect(page.getByTestId("refund-request")).toBeVisible();     // (التنبيه بيظهر لمدير الحجوزات كطلب رد جديد)
    let [b] = await env.q("select * from bookings where id = $1", [id]);
    expect(b).toMatchObject({ total_room: 200, amount_paid: 400, refund_pending: true, checkout: cairoDate(1) });
    const req = page.getByTestId("refund-request");
    expect(digits(await req.innerText())).toContain("200USD");
    await req.getByRole("button", { name: "رد الفلوس" }).click();
    await expect(toast(page)).toContainText("تم رد");
    [b] = await env.q("select * from bookings where id = $1", [id]);
    expect(b).toMatchObject({ amount_paid: 200, refund_pending: false, settled: true });
    expect(await sumLedger(env)).toBe(200);
  });
});

const tabBadge = (page) => page.locator(".cx-tab", { hasText: "الحجوزات" });
