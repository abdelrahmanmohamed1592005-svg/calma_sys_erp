// أكواد الأفراد اللي المستخدم بيكتبها، إلغاء الحجز (بدل المسح) وحالة رد الفلوس، الدخول المبكر
// (عادي وأونلاين) والمغادرة المبكرة وطلب الرد، وإن أي تحصيل بيتسمع في الحجز واليومية والتقرير بنفس الرقم.
import { test, expect } from "../fixtures";
import { login, logout, goTab, field, boardTile, roomCard, toast, digits, cairoDate, refresh } from "../ui";

async function users(env) {
  await env.seedUser("boss", "gm", "المدير");
  await env.seedUser("ahmed", "staff", "أحمد");
  await env.seedUser("rawan", "reservations", "روان");
}
const get = async (env, name) => (await env.q("select * from bookings where guest_name = $1", [name]))[0];
const guestCard = (page, name) => page.locator(".cx-card", { hasText: name }).last();
const priceInput = (page) => page.locator("xpath=//label[contains(.,'السعر لليلة')]/following-sibling::div//input[@type='number']");

// مجموع التحصيل في كل اليوميات (صفوف الغرف + الكافيتيريا + بنود الفندق) بكل عملة
async function ledgerByCur(env) {
  const out = {};
  for (const r of await env.q("select rows, cafeteria, hotel_rows from shift_records")) {
    for (const x of [...r.rows, r.cafeteria, ...(r.hotel_rows || [])]) {
      const v = Number(x?.collectionAmt) || 0;
      if (v) out[x.collectionCurrency] = (out[x.collectionCurrency] || 0) + v;
    }
  }
  return out;
}
// اللي الحجوزات بتقول إنه اتحصّل فعلاً (amount_paid) بكل عملة
async function paidByCur(env) {
  const out = {};
  for (const r of await env.q("select currency, sum(amount_paid) s from bookings group by currency")) if (Number(r.s)) out[r.currency] = Number(r.s);
  return out;
}
// القاعدة الذهبية: أي مبلغ اتحصّل (أو اترد) على حجز لازم يظهر بنفس الرقم في اليومية
async function expectSync(env, expected) {
  const l = await ledgerByCur(env), p = await paidByCur(env);
  expect(l).toEqual(p);
  if (expected) expect(l).toEqual(expected);
}
async function reportTotal(page, text) {
  await goTab(page, "التقارير");
  const grid = page.locator(".cx-report-grid").first();
  await expect(grid).toContainText("إجمالي التحصيل");
  expect(digits(await grid.locator(".cx-card", { hasText: "إجمالي التحصيل" }).first().innerText())).toContain(text);
}

test.describe("أكواد الأفراد بيكتبها المستخدم", () => {
  test("كود لكل فرد يتكتب في الحجز، البحث بيطلّع الغرفة، تعديله من بلوك الغرفة، ونزيل راجع يطلّع كل غرفه", async ({ page, env }) => {
    await users(env);
    await env.seedShift("ahmed");
    await page.goto("/");
    await login(page, "ahmed");
    await goTab(page, "الحجوزات");
    await page.getByRole("button", { name: /حجز جديد/ }).click();
    await page.locator(".cx-card[data-calma-editing] select.cx-select").first().selectOption("608");
    await field(page, "اسم النزيل").fill("Family Three");
    await field(page, "عدد الأفراد").fill("3");
    await expect(page.getByTestId("guest-code-input-3")).toBeVisible();
    await expect(page.getByTestId("guest-code-input-4")).toHaveCount(0);
    await field(page, "تاريخ الخروج").fill(cairoDate(2));
    await priceInput(page).fill("100");
    // نفس الكود لفردين => مرفوض
    await page.getByTestId("guest-code-input-1").fill("A-1");
    await page.getByTestId("guest-code-input-2").fill("a-1");
    await page.getByRole("button", { name: /حفظ الحجز/ }).click();
    await expect(toast(page)).toContainText("مكتوب لأكتر من فرد");
    expect(await env.q("select 1 from bookings")).toHaveLength(0);
    await page.getByTestId("guest-code-input-2").fill("A-2");
    // الفرد التالت من غير كود
    await page.getByRole("button", { name: /حفظ الحجز/ }).click();
    await expect(toast(page)).toContainText("تم الحفظ");

    const b = await get(env, "Family Three");
    expect(b.guest_codes).toEqual(["A-1", "A-2", ""]);
    const g = await env.q("select seq, code, room from booking_guests where booking_id = $1 order by seq", [b.id]);
    expect(g).toEqual([{ seq: 1, code: "A-1", room: 608 }, { seq: 2, code: "A-2", room: 608 }]);       // مفيش كود متولّد للفرد التالت

    // البحث في الحجوزات (من غير حساسية لحالة الحروف)
    await page.getByPlaceholder(/بحث برقم الغرفة/).fill("a-2");
    await expect(page.getByTestId("guest-code-result")).toContainText("فرد 2");
    await expect(page.getByTestId("guest-code-result")).toContainText("608");
    await page.getByPlaceholder(/بحث برقم الغرفة/).fill("");

    // لوحة الغرف: بحث بالكود + فتح الغرفة + تعديل الأكواد من بطاقة الغرفة
    await goTab(page, "لوحة الغرف");
    await page.getByTestId("board-code-search").fill("A-1");
    const hit = page.getByTestId("guest-code-hit");
    await expect(hit).toHaveCount(1);
    await hit.getByRole("button", { name: "افتح الغرفة" }).click();
    await expect(roomCard(page)).toContainText("Family Three");
    await page.getByTestId("board-code-input-3").fill("A-3");
    await page.getByTestId("board-code-input-1").fill("ZED-1");
    await page.getByTestId("board-codes-save").click();
    await expect(toast(page)).toContainText("تم حفظ أكواد الأفراد");
    expect((await get(env, "Family Three")).guest_codes).toEqual(["ZED-1", "A-2", "A-3"]);
    expect((await env.q("select code from booking_guests where booking_id = $1 order by seq", [b.id])).map((r) => r.code)).toEqual(["ZED-1", "A-2", "A-3"]);

    // نزيل راجع: نفس الكود في حجز تاني على غرفة تانية => البحث يطلّع الغرفتين
    const r2 = await env.seedBooking({ room: 610, guest: "Returning", start: 10, nights: 1 });
    await env.q("update bookings set guest_codes = '[\"zed-1\"]'::jsonb where id = $1", [r2]);
    await refresh(page);
    await page.getByTestId("board-code-search").fill("ZED-1");
    await expect(page.getByTestId("guest-code-hit")).toHaveCount(2);
    await expect(page.getByTestId("guest-code-result")).toContainText("Returning");
    await expect(page.getByTestId("guest-code-result")).toContainText("Family Three");
    await page.getByTestId("board-code-search").fill("NOPE-NOPE");
    await expect(page.getByTestId("board-code-missing")).toBeVisible();
  });
});

test.describe("إلغاء الحجز (مش مسح)", () => {
  test("مفيش مسح نهائي من الشاشة، والإلغاء بيخلّي الحجز ظاهر في 'الحجوزات الملغية' بحالة الفلوس", async ({ page, env }) => {
    await users(env);
    await env.seedBooking({ room: 601, guest: "Unpaid One", nights: 1, price: 100 });
    await env.seedBooking({ room: 602, guest: "Still Active", nights: 1, price: 100 });
    await page.goto("/");
    await login(page, "rawan");
    await goTab(page, "الحجوزات");
    await expect(page.locator("button svg.lucide-trash2, button svg.lucide-trash-2")).toHaveCount(0);
    await guestCard(page, "Unpaid One").getByTestId("cancel-booking").getByRole("button", { name: "إلغاء الحجز" }).click();
    await guestCard(page, "Unpaid One").getByRole("button", { name: "تأكيد الإلغاء؟" }).click();
    await expect(toast(page)).toContainText("تم إلغاء الحجز");
    await expect(toast(page)).toContainText("الحجوزات الملغية");
    // الحجز ظاهر في القايمة بعلامته وحالة فلوسه
    const card = page.getByTestId("booking-cancelled").filter({ hasText: "Unpaid One" });
    await expect(card).toBeVisible();
    await expect(card).toContainText("حجز ملغي");
    await expect(card.getByTestId("refund-status")).toContainText("مفيش رد مطلوب");
    await expect(card.getByTestId("cancel-booking")).toHaveCount(0);       // مايتلغاش مرتين
    expect((await get(env, "Unpaid One")).status).toBe("ملغي");           // لسه موجود في القاعدة
    await page.getByTestId("status-filter-cancelled").click();
    await expect(page.getByText("Unpaid One").first()).toBeVisible();
    await expect(page.getByText("Still Active")).toHaveCount(0);
    await page.getByTestId("status-filter-active").click();
    await expect(page.getByText("Unpaid One")).toHaveCount(0);
    await expect(page.getByText("Still Active").first()).toBeVisible();
    await page.getByTestId("status-filter-all").click();
    await expect(page.getByText("Unpaid One").first()).toBeVisible();
  });

  test("إلغاء حجز عليه فلوس: طلب رد فلوس بيتفتح وبيبان قبل القرار، وبعد الرد اليومية والحجز يتطابقوا", async ({ page, env }) => {
    await users(env);
    const id = await env.seedBooking({ room: 603, guest: "Paid Cancel", nights: 2, price: 100, paid: 200, settled: true });
    await env.seedShift("ahmed", { collections: [{ room: 603, amount: 200, bookingId: id }] });
    await expectSync(env, { USD: 200 });
    await page.goto("/");
    await login(page, "rawan");
    await goTab(page, "الحجوزات");
    await guestCard(page, "Paid Cancel").getByTestId("cancel-booking").getByRole("button", { name: "إلغاء الحجز" }).click();
    await guestCard(page, "Paid Cancel").getByRole("button", { name: "تأكيد الإلغاء؟" }).click();
    const card = page.getByTestId("booking-cancelled").filter({ hasText: "Paid Cancel" });
    await expect(card.getByTestId("refund-request")).toContainText("طلب رد فلوس");
    expect(digits(await card.getByTestId("refund-request").innerText())).toContain("200USD");
    expect(await get(env, "Paid Cancel")).toMatchObject({ status: "ملغي", refund_pending: true, amount_paid: 200 });
    await expectSync(env, { USD: 200 });                  // لسه ماترّدش: الفلوس لسه في اليومية
    await card.getByRole("button", { name: "رد الفلوس" }).click();
    await card.getByRole("button", { name: "تأكيد الرد؟" }).click();
    await expect(toast(page)).toContainText("تم رد");
    expect(await get(env, "Paid Cancel")).toMatchObject({ status: "ملغي", refund_pending: false, refund_decision: "refunded", amount_paid: 0 });
    await expect(card.getByTestId("refund-status")).toContainText("اترد للنزيل");
    expect(await ledgerByCur(env)).toEqual({});           // اتخصم من اليومية
    expect(await paidByCur(env)).toEqual({});
  });
});

test.describe("الدخول المبكر", () => {
  test("موظف الشيفت يسجّل الدخول المبكر ويحصّله: بيدخل الحجز واليومية والتقرير والتوتال بنفس الرقم", async ({ page, env }) => {
    await users(env);
    await env.seedBooking({ room: 604, guest: "Early Bird", nights: 2, price: 100 });
    await env.seedShift("ahmed");
    await page.goto("/");
    await login(page, "ahmed");
    await goTab(page, "لوحة الغرف");
    await boardTile(page, 604).click();
    await page.getByTestId("early-fee").fill("50");
    await page.getByTestId("early-note").fill("وصل ٧ الصبح");
    await page.getByTestId("early-apply").click();
    await expect(toast(page)).toContainText("اتحصّل");
    expect(await get(env, "Early Bird")).toMatchObject({ amount_paid: 50, settled: false, early_checkin: { applied: true, fee: 50, note: "وصل ٧ الصبح" } });
    await expectSync(env, { USD: 50 });
    // الإجمالي ٢٥٠ والمتبقي ٢٠٠
    expect(digits(await roomCard(page).getByTestId("board-due").innerText())).toContain("200");
    await expect(page.getByTestId("early-checkin-panel")).toHaveCount(0);      // اتسجّل مرة واحدة بس
    // تحصيل الباقي
    await roomCard(page).getByRole("button", { name: /تسجيل تحصيل كامل المبلغ/ }).click();
    await expect(toast(page)).toContainText("تم تسجيل التحصيل الكامل");
    expect(await get(env, "Early Bird")).toMatchObject({ amount_paid: 250, settled: true });
    await expectSync(env, { USD: 250 });
    // اليومية: صفوف الحجز بتجمع ٢٥٠
    const [rec] = await env.q("select rows from shift_records");
    expect(rec.rows.filter((r) => r.room === 604).reduce((s, r) => s + (Number(r.collectionAmt) || 0), 0)).toBe(250);
    expect(rec.rows.some((r) => r.room === 604 && /دخول مبكر/.test(r.collectionDesc))).toBe(true);
    // التقرير (مدير الحجوزات): إجمالي التحصيل ٢٥٠
    await logout(page);
    await login(page, "rawan");
    await reportTotal(page, "250");
  });

  test("دخول مبكر على حجز متحصّل بالكامل: العلامة بتتشال وبعد التحصيل بترجع، والفلوس في اليومية", async ({ page, env }) => {
    await users(env);
    const id = await env.seedBooking({ room: 605, guest: "Settled Early", nights: 1, price: 100, paid: 100, settled: true });
    await env.seedShift("ahmed", { collections: [{ room: 605, amount: 100, bookingId: id }] });
    await page.goto("/");
    await login(page, "ahmed");
    await goTab(page, "لوحة الغرف");
    await boardTile(page, 605).click();
    await page.getByTestId("early-fee").fill("30");
    await page.getByTestId("early-apply").click();
    await expect(toast(page)).toContainText("اتحصّل");
    expect(await get(env, "Settled Early")).toMatchObject({ amount_paid: 130, settled: true, early_checkin: { applied: true, fee: 30 } });
    await expectSync(env, { USD: 130 });
  });

  test("دخول مبكر من غير تحصيل: بيزوّد المتبقي والغرفة تبقى حمراء، وبعدين تحصيله من الزرار العادي", async ({ page, env }) => {
    await users(env);
    const id = await env.seedBooking({ room: 606, guest: "Pay Later", nights: 1, price: 100, paid: 100, settled: false });
    await env.seedShift("ahmed", { collections: [{ room: 606, amount: 100, bookingId: id }] });
    await page.goto("/");
    await login(page, "ahmed");
    await goTab(page, "لوحة الغرف");
    await boardTile(page, 606).click();
    await page.getByTestId("early-fee").fill("40");
    await page.getByTestId("early-collect").uncheck();
    await page.getByTestId("early-apply").click();
    await expect(toast(page)).toContainText("لسه متبقي");
    expect(await get(env, "Pay Later")).toMatchObject({ amount_paid: 100, settled: false });
    await expect(page.getByText(/مشغولة - متبقي فلوس 1/)).toBeVisible();
    await expectSync(env, { USD: 100 });
    await roomCard(page).getByRole("button", { name: /تسجيل تحصيل كامل المبلغ/ }).click();
    await expect(toast(page)).toContainText("تم تسجيل التحصيل الكامل");
    expect(await get(env, "Pay Later")).toMatchObject({ amount_paid: 140, settled: true });
    await expectSync(env, { USD: 140 });
  });

  test("حجز أونلاين: رسم الدخول المبكر والخدمات بيتحصّلوا في الفندق وبيدخلوا اليومية والتقرير (مش بيضيعوا)، وسعر الغرفة مش بيتعدّ مرتين", async ({ page, env }) => {
    await users(env);
    await env.seedBooking({ room: 607, guest: "Booking Dot Com", nights: 2, price: 100, payment_details: { senderName: "", senderNumber: "", ref: "BK-1", onlinePaid: true } });
    await env.seedShift("ahmed");
    await page.goto("/");
    await login(page, "ahmed");
    await goTab(page, "لوحة الغرف");
    await expect(page.getByText(/مشغولة - متحصّلة 1/)).toBeVisible();          // مفيش حاجة مستحقة في الفندق لسه
    await boardTile(page, 607).click();
    await page.getByTestId("early-fee").fill("40");
    await page.getByTestId("early-apply").click();
    await expect(toast(page)).toContainText("اتحصّل");
    expect(await get(env, "Booking Dot Com")).toMatchObject({ amount_paid: 40, early_checkin: { applied: true, fee: 40 } });
    await expectSync(env, { USD: 40 });
    await expect(page.getByText(/مشغولة - متحصّلة 1/)).toBeVisible();
    // خدمة إضافية (جولات) من بطاقة الغرفة => متبقي في الفندق والغرفة تحمر لحد ما تتحصّل
    await roomCard(page).locator("xpath=.//label[contains(.,'جولات')]/following-sibling::input").fill("30");
    await roomCard(page).getByRole("button", { name: /حفظ الرسوم/ }).click();
    await expect(toast(page)).toContainText("تم حفظ الرسوم الإضافية");
    await expect(page.getByText(/مشغولة - متبقي فلوس 1/)).toBeVisible();
    expect(digits(await roomCard(page).getByTestId("board-due").innerText())).toContain("30");
    await roomCard(page).getByTestId("collect-extras").click();
    await expect(toast(page)).toContainText("تم تسجيل تحصيل الخدمات");
    expect(await get(env, "Booking Dot Com")).toMatchObject({ amount_paid: 70 });
    await expectSync(env, { USD: 70 });
    await expect(page.getByText(/مشغولة - متحصّلة 1/)).toBeVisible();
    // التقرير: التحصيل ٧٠ (الفندق) وإيراد الأونلاين = سعر الغرفة ٢٠٠ بس
    await logout(page);
    await login(page, "rawan");
    await reportTotal(page, "70");
    await expect(page.locator("body")).toContainText("الحجوزات الأونلاين");
    const online = page.locator(".cx-card", { hasText: "الحجوزات الأونلاين" }).last();
    expect(digits(await online.innerText())).toContain("200");
    expect(digits(await online.innerText())).not.toContain("270");
  });

  test("مدير الحجوزات يسجّل دخول مبكر على حجز موجود من الفورم (من غير تحصيل) والموظف يحصّله", async ({ page, env }) => {
    await users(env);
    await env.seedBooking({ room: 608, guest: "Res Early", nights: 1, price: 100 });
    await env.seedShift("ahmed");
    await page.goto("/");
    await login(page, "rawan");
    await goTab(page, "الحجوزات");
    await guestCard(page, "Res Early").locator("button").first().click();
    const early = page.locator("xpath=//input[@type='checkbox'][ancestor::label[contains(.,'دخول مبكر')]]");
    await expect(early).toBeEnabled();
    await early.check();
    await page.locator("xpath=//label[contains(.,'رسم الدخول المبكر')]/following-sibling::input").fill("25");
    await page.getByRole("button", { name: /حفظ الحجز/ }).click();
    await expect(toast(page)).toContainText("تم الحفظ");
    expect(await get(env, "Res Early")).toMatchObject({ amount_paid: 0, early_checkin: { applied: true, fee: 25 } });
    await logout(page);
    await login(page, "ahmed");
    await goTab(page, "لوحة الغرف");
    await boardTile(page, 608).click();
    await roomCard(page).getByRole("button", { name: /تسجيل تحصيل كامل المبلغ/ }).click();
    await expect(toast(page)).toContainText("تم تسجيل التحصيل الكامل");
    expect(await get(env, "Res Early")).toMatchObject({ amount_paid: 125, settled: true });
    await expectSync(env, { USD: 125 });
  });
});

test.describe("المغادرة المبكرة وطلب رد الفلوس", () => {
  async function leave(page, room) {
    await goTab(page, "لوحة الغرف");
    await boardTile(page, room).click();
    await roomCard(page).getByTestId("early-leave").getByRole("button", { name: /غادر مبكرًا/ }).click();
    await roomCard(page).getByRole("button", { name: "تأكيد المغادرة المبكرة؟" }).click();
  }

  test("نزيل ٣ ليالي مدفوع كامل قعد ليلة وخرج: بيتحاسب ليلة والباقي طلب رد لمدير الحجوزات، وبعد الرد اليومية تتطابق", async ({ page, env }) => {
    await users(env);
    const id = await env.seedBooking({ room: 609, guest: "Leaves Early", start: -1, nights: 3, price: 100, paid: 300, settled: true });
    await env.seedShift("ahmed", { collections: [{ room: 609, amount: 300, bookingId: id }] });
    await page.goto("/");
    await login(page, "ahmed");
    await leave(page, 609);
    await expect(toast(page)).toContainText("اتحاسب على 1 ليلة من 3");
    await expect(toast(page)).toContainText("طلب رد فلوس");
    expect(await get(env, "Leaves Early")).toMatchObject({ checkout: cairoDate(0), total_room: 100, left_early: true, status: "تم تسجيل الخروج", refund_pending: true, amount_paid: 300 });
    await expectSync(env, { USD: 300 });
    await logout(page);
    await login(page, "rawan");
    await goTab(page, "الحجوزات");
    const req = guestCard(page, "Leaves Early").getByTestId("refund-request");
    expect(digits(await req.innerText())).toContain("200USD");
    await req.getByRole("button", { name: "رد الفلوس" }).click();
    await req.getByRole("button", { name: "تأكيد الرد؟" }).click();
    await expect(toast(page)).toContainText("تم رد");
    expect(await get(env, "Leaves Early")).toMatchObject({ amount_paid: 100, refund_pending: false, refund_decision: "refunded", refunded_amount: 200 });
    await expectSync(env, { USD: 100 });
  });

  test("نزيل دخل النهارده ومشي في نفس اليوم (ليلتين محجوزين): الحد الأدنى ليلة والباقي طلب رد", async ({ page, env }) => {
    await users(env);
    const id = await env.seedBooking({ room: 611, guest: "Same Day", start: 0, nights: 2, price: 100, paid: 200, settled: true });
    await env.seedShift("ahmed", { collections: [{ room: 611, amount: 200, bookingId: id }] });
    await page.goto("/");
    await login(page, "ahmed");
    await leave(page, 611);
    await expect(toast(page)).toContainText("الحد الأدنى ليلة");
    expect(await get(env, "Same Day")).toMatchObject({ checkin: cairoDate(0), checkout: cairoDate(0), total_room: 100, left_early: true, refund_pending: true });
    await expect(toast(page)).toContainText("طلب رد فلوس");
  });

  test("مغادرة مبكرة والمدفوع مايزيدش عن الليالي اللي قعدها: مفيش رد، ولو لسه عليه فلوس بيتقال", async ({ page, env }) => {
    await users(env);
    const a = await env.seedBooking({ room: 612, guest: "Exact Paid", start: -1, nights: 3, price: 100, paid: 100, settled: false });
    await env.seedBooking({ room: 613, guest: "Owes Money", start: -1, nights: 3, price: 100, paid: 0 });
    await env.seedShift("ahmed", { collections: [{ room: 612, amount: 100, bookingId: a }] });
    await page.goto("/");
    await login(page, "ahmed");
    await leave(page, 612);
    await expect(toast(page)).toContainText("مفيش رد");
    expect(await get(env, "Exact Paid")).toMatchObject({ total_room: 100, refund_pending: false, amount_paid: 100 });
    await leave(page, 613);
    await expect(toast(page)).toContainText("لسه متبقي على النزيل");
    expect(await get(env, "Owes Money")).toMatchObject({ total_room: 100, refund_pending: false, left_early: true });
    await expectSync(env, { USD: 100 });
  });
});
