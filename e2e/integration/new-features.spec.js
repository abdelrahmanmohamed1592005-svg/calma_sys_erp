// الميزات الجديدة: أكواد الأفراد، الحجز الأونلاين (من غير وسيلة دفع ولا عمولة)، ظهور التسكين المكرر
// وتحصيله المنفصل، مصاريف وإيرادات الفندق في اليومية، سعر الليلة على بلوك الغرفة، وحالة الحجز الملغي.
import { test, expect } from "../fixtures";
import { login, logout, goTab, field, boardTile, roomCard, toast, refresh, digits, cairoDate, addBooking, shiftDay, myShiftKey, SHIFT_LABEL, openRoom, openMore } from "../ui";

async function users(env) {
  await env.seedUser("boss", "gm", "المدير");
  await env.seedUser("ahmed", "staff", "أحمد");
  await env.seedUser("rawan", "reservations", "روان");
}
const priceInput = (page) => page.locator("xpath=//label[contains(.,'السعر لليلة')]/following-sibling::div//input[@type='number']");
const guestCard = (page, name) => page.locator(".cx-card", { hasText: name }).last();
const get = async (env, name) => (await env.q("select * from bookings where guest_name = $1", [name]))[0];

test.describe("الحجز المدفوع أونلاين", () => {
  test("طريقة الدفع بتتشال لما تحدد أونلاين، ومفيش خانات عمولة، وبترجع لو شلت العلامة", async ({ page, env }) => {
    await users(env);
    await page.goto("/");
    await login(page, "rawan");
    await goTab(page, "الحجوزات");
    await page.getByRole("button", { name: /حجز جديد/ }).click();
    const methodSelect = page.locator("xpath=//label[contains(.,'طريقة الدفع')]/following-sibling::select");
    await expect(methodSelect).toBeVisible();
    await openMore(page);
    await page.getByRole("checkbox", { name: /الحجز مدفوع أونلاين/ }).check();
    await expect(page.locator("xpath=//label[contains(.,'طريقة الدفع')]")).toHaveCount(0);
    await expect(page.getByText(/عمولة/)).toHaveCount(0);
    await expect(page.getByText(/الصافي|بالعمولة/)).toHaveCount(0);
    await page.getByRole("checkbox", { name: /الحجز مدفوع أونلاين/ }).uncheck();
    await expect(methodSelect).toBeVisible();
    // وحجز أونلاين فعلي: مفيش وسيلة دفع ظاهرة في القائمة ولا البطاقة
    await openMore(page);
    await page.getByRole("checkbox", { name: /الحجز مدفوع أونلاين/ }).check();
    await page.locator(".cx-card[data-calma-editing] select.cx-select").first().selectOption("605");
    await field(page, "اسم النزيل").fill("Platform Guest");
    await field(page, "تاريخ الخروج").fill(cairoDate(2));
    await priceInput(page).fill("100");
    await page.getByRole("button", { name: /حفظ الحجز/ }).click();
    await expect(toast(page)).toContainText("تم الحفظ");
    const b = await get(env, "Platform Guest");
    expect(b.payment_details.onlinePaid).toBe(true);
    expect(b.payment_details).not.toHaveProperty("commissionPct");
    const card = guestCard(page, "Platform Guest");
    await expect(card).toContainText("مدفوع أونلاين");
    expect(digits(await card.innerText())).not.toMatch(/Booking\.com·كاش|مباشر·كاش/);
    await goTab(page, "لوحة الغرف");
    await openRoom(page, 605);
    await expect(roomCard(page)).toContainText("مدفوع أونلاين");
    await expect(roomCard(page).getByText("طريقة الدفع")).toHaveCount(0);
  });
});

test.describe("التسكين المكرر في لوحة الغرف واليومية", () => {
  test("تسكين مكرر: النزيل الجديد بيظهر في بلوك الغرفة بتفاصيله وسعر ليلته، والقديم بيتسجّل غادر مبكرًا", async ({ page, env }) => {
    await users(env);
    const oldId = await env.seedBooking({ room: 611, guest: "Old Guest", start: -2, nights: 4, price: 100, paid: 400, settled: true });
    await env.seedShift("ahmed", { collections: [{ room: 611, amount: 400, bookingId: oldId }] });
    await page.goto("/");
    await login(page, "ahmed");
    await goTab(page, "لوحة الغرف");
    // وبعدين يسكّن النزيل الجديد (تسكين مكرر)
    await goTab(page, "الحجوزات");
    await page.getByRole("button", { name: /حجز جديد/ }).click();
    await page.locator(".cx-card[data-calma-editing] select.cx-select").first().selectOption("611");
    await field(page, "اسم النزيل").fill("New Guest");
    await field(page, "عدد الأفراد").fill("2");
    await field(page, "تاريخ الخروج").fill(cairoDate(2));
    await priceInput(page).fill("150");
    await page.getByRole("button", { name: /حفظ الحجز/ }).click();
    await expect(toast(page)).toContainText("تم الحفظ");

    await goTab(page, "لوحة الغرف");
    // بلوك الغرفة من بره: اسم النزيل الجديد + سعر الليلة + علامة التسكين المكرر
    const tile = boardTile(page, 611);
    await expect(tile).toContainText("New Guest");
    await expect(page.getByTestId("tile-price-611")).toContainText("150 USD / ليلة".replace("150", "١٥٠"));
    await expect(tile).toContainText("تسكين مكرر");
    // التفاصيل بتظهر لما أفتح الغرفة
    await tile.click();
    await expect(roomCard(page)).toContainText("New Guest");
    await expect(roomCard(page)).toContainText("تسكين مكرر");
    await expect(page.getByTestId("departed-card")).toContainText("Old Guest");
  });

  test("حتى لو الحالة اليدوية 'غادر مبكرًا' لسه موجودة (حجز اتسكّن بعدها من جهاز تاني)، النزيل الجديد هو اللي بيبان", async ({ page, env }) => {
    await users(env);
    await env.seedBooking({ room: 612, guest: "Gone", start: -1, nights: 1, price: 100, leftEarly: true });
    await env.q("insert into room_overrides(room_number, status, updated_by) values (612, 'early_checkout', 'x')");
    await new Promise((r) => setTimeout(r, 50));
    await env.seedBooking({ room: 612, guest: "Newcomer", start: 0, nights: 2, price: 80, by: "rawan", role: "reservations" });
    await page.goto("/");
    await login(page, "rawan");
    await expect(boardTile(page, 612)).toContainText("Newcomer");
    await openRoom(page, 612);
    await expect(roomCard(page)).toContainText("Newcomer");
  });

  test("تحصيل التسكين المكرر بيتسجّل في صف مستقل في اليومية (مش مدموج مع تحصيل الحجز اللي قبله)، ورد الفلوس بيتخصم من صف صاحبه", async ({ page, env }) => {
    await users(env);
    const oldId = await env.seedBooking({ room: 613, guest: "Previous Guest", start: -1, nights: 3, price: 100, paid: 300, settled: true });
    await env.seedShift("ahmed", { collections: [{ room: 613, amount: 300, bookingId: oldId, desc: "تحصيل Previous Guest" }] });
    await page.goto("/");
    await login(page, "ahmed");
    // تسكين مكرر بمقدّم ٥٠ كاش (نفس الوسيلة والعملة بتاعة القديم بالظبط)
    await goTab(page, "الحجوزات");
    await page.getByRole("button", { name: /حجز جديد/ }).click();
    await page.locator(".cx-card[data-calma-editing] select.cx-select").first().selectOption("613");
    await field(page, "اسم النزيل").fill("Replacement Guest");
    await field(page, "تاريخ الخروج").fill(cairoDate(2));
    await priceInput(page).fill("100");
    await page.locator("xpath=//label[contains(.,'المدفوع حتى الآن')]/following-sibling::input").fill("50");
    await page.getByRole("button", { name: /حفظ الحجز/ }).click();
    await expect(toast(page)).toContainText("تم الحفظ");
    const nw = await get(env, "Replacement Guest");
    let [rec] = await env.q("select rows from shift_records");
    let rows = rec.rows.filter((r) => r.room === 613 && Number(r.collectionAmt) !== 0);
    expect(rows).toHaveLength(2);                                         // صفين مش صف واحد
    expect(rows.find((r) => r.bookingId === oldId)).toMatchObject({ collectionAmt: 300 });
    expect(rows.find((r) => r.bookingId === nw.id)).toMatchObject({ collectionAmt: 50 });
    expect(rows.find((r) => r.bookingId === nw.id).collectionDesc).toContain("Replacement Guest");

    // الصف الجديد بيظهر في شاشة اليومية كصف إضافي بتحصيله الخاص
    await goTab(page, "اليومية");
    const ledgerRows = page.locator("table.cx-table tbody tr", { hasText: "613" });
    await expect(ledgerRows).toHaveCount(2);
    await expect(ledgerRows.nth(1).getByPlaceholder("بيان التحصيل")).toHaveValue(/Replacement Guest/);
    await expect(ledgerRows.nth(1)).toContainText("صف إضافي");

    // تحصيل باقي المبلغ من لوحة الغرف بيروح لنفس صف الحجز الجديد
    await goTab(page, "لوحة الغرف");
    await openRoom(page, 613);
    await roomCard(page).getByRole("button", { name: /تسجيل تحصيل كامل المبلغ/ }).click();
    await expect(toast(page)).toContainText("تم تسجيل التحصيل الكامل");
    [rec] = await env.q("select rows from shift_records");
    rows = rec.rows.filter((r) => r.room === 613 && Number(r.collectionAmt) !== 0);
    expect(rows).toHaveLength(2);
    expect(Number(rows.find((r) => r.bookingId === nw.id).collectionAmt)).toBe(200);
    expect(Number(rows.find((r) => r.bookingId === oldId).collectionAmt)).toBe(300);
    await logout(page);

    // مدير الحجوزات يلغي الحجز القديم ويرد فلوسه: بيتخصم من صف القديم بس
    await env.q("update bookings set status = 'ملغي' where id = $1", [oldId]);
    await login(page, "rawan");
    await goTab(page, "الحجوزات");
    const req = guestCard(page, "Previous Guest").getByTestId("refund-request");
    await req.getByRole("button", { name: "رد الفلوس" }).click();
    await expect(toast(page)).toContainText("تم رد");
    [rec] = await env.q("select rows from shift_records");
    rows = rec.rows.filter((r) => r.room === 613);
    expect(Number(rows.find((r) => r.bookingId === oldId).collectionAmt)).toBe(0);
    expect(Number(rows.find((r) => r.bookingId === nw.id).collectionAmt)).toBe(200);
  });
});

test.describe("مصاريف وإيرادات الفندق في اليومية", () => {
  test("الموظف يضيف بنود مصاريف/إيرادات فندق: بتدخل في الخزينة والإجماليات والتقارير، وتظهر في الاستعراض", async ({ page, env }) => {
    await users(env);
    await page.goto("/");
    await login(page, "ahmed");
    await goTab(page, "اليومية");
    await page.getByRole("button", { name: new RegExp(SHIFT_LABEL[myShiftKey()]) }).click();
    await expect(page.getByText("شيفتك الوحيد المتاح ليك النهارده")).toBeVisible();
    const hotel = page.getByTestId("hotel-rows");
    await expect(hotel).toContainText("مصاريف وإيرادات الفندق");
    const row0 = page.getByTestId("hotel-row-0");
    await row0.locator("select.cx-select").nth(0).selectOption("كهرباء ومياه");
    await row0.getByPlaceholder("بيان المصروف").fill("فاتورة الكهرباء");
    await row0.getByPlaceholder("مبلغ المصروف").fill("120");
    await row0.getByPlaceholder("بيان الإيراد").fill("إيجار القاعة");
    await row0.getByPlaceholder("مبلغ الإيراد").fill("500");
    await page.getByTestId("hotel-row-add").click();
    const row1 = page.getByTestId("hotel-row-1");
    await row1.locator("select.cx-select").nth(0).selectOption("نظافة");
    await row1.getByPlaceholder("بيان المصروف").fill("خامات تنظيف");
    await row1.getByPlaceholder("مبلغ المصروف").fill("30");
    await row1.locator("select.cx-select").nth(1).selectOption("USD");
    await page.waitForTimeout(1400);
    const rec = (await env.q("select * from shift_records"))[0];
    expect(rec.hotel_rows).toHaveLength(2);
    expect(rec.hotel_rows[0]).toMatchObject({ expenseDesc: "فاتورة الكهرباء", collectionDesc: "إيجار القاعة" });
    expect(Number(rec.hotel_rows[0].expenseAmt)).toBe(120);
    expect(Number(rec.hotel_rows[0].collectionAmt)).toBe(500);
    expect(rec.hotel_rows[1]).toMatchObject({ expenseCategory: "نظافة", expenseCurrency: "USD" });
    // رصيد الخزينة: ٥٠٠ - ١٢٠ = ٣٨٠ جنيه، و -٣٠ دولار
    const egp = page.locator(`xpath=//div[./div[normalize-space(.)='جنيه (EGP)']]`).last();
    expect(digits(await egp.innerText())).toContain("رصيدالخزينة380");
    // قفل الشيفت بيحفظ الإجماليات شاملة بنود الفندق
    await page.getByRole("button", { name: /إقفال الشيفت/ }).click();
    await expect(page.getByText(/أُقفل بواسطة/)).toBeVisible();
    const closed = (await env.q("select * from shift_records"))[0];
    expect(closed.total_expenses).toEqual({ EGP: 120, USD: 30 });
    expect(closed.total_collections).toEqual({ EGP: 500 });
    expect(closed.by_category).toEqual({ "كهرباء ومياه": { EGP: 120 }, "نظافة": { USD: 30 } });
    expect(closed.closing_cash).toEqual({ EGP: 380, USD: -30 });
    await expect(page.getByTestId("hotel-row-add")).toHaveCount(0);       // اتقفل
    await logout(page);

    // مدير الحجوزات: التقرير + استعراض اليومية
    await login(page, "rawan");
    await goTab(page, "التقارير");
    const grid = digits(await page.locator(".cx-report-grid").first().innerText());
    expect(grid).toContain("500ج");
    expect(grid).toContain("120ج");
    expect(grid).toContain("30$");
    expect(digits(await page.locator("table.cx-table tr", { hasText: "كهرباء ومياه" }).first().innerText())).toContain("120");
    await goTab(page, "اليومية");
    await page.locator('input[type="date"]').fill(shiftDay());
    await page.getByRole("button", { name: SHIFT_LABEL[myShiftKey()] }).click();
    await expect(page.getByTestId("hotel-rows")).toContainText("فاتورة الكهرباء".length ? "مصاريف وإيرادات الفندق" : "");
    await expect(page.getByTestId("hotel-row-0").getByPlaceholder("بيان المصروف")).toHaveValue("فاتورة الكهرباء");
    await expect(page.getByTestId("hotel-row-0").getByPlaceholder("بيان المصروف")).toBeDisabled();
  });

  test("حذف بند فندق، وأقل من بند واحد مش مسموح", async ({ page, env }) => {
    await users(env);
    await env.seedShift("ahmed");
    await page.goto("/");
    await login(page, "ahmed");
    await goTab(page, "اليومية");
    await expect(page.getByRole("button", { name: /شيل بند فندق/ })).toHaveCount(0);   // بند واحد: مفيش حذف
    await page.getByTestId("hotel-row-add").click();
    await page.getByTestId("hotel-row-1").getByPlaceholder("بيان المصروف").fill("مؤقت");
    await page.waitForTimeout(1200);
    expect((await env.q("select hotel_rows from shift_records"))[0].hotel_rows).toHaveLength(2);
    await page.getByRole("button", { name: "شيل بند فندق 2" }).click();
    await page.waitForTimeout(1000);
    expect((await env.q("select hotel_rows from shift_records"))[0].hotel_rows).toHaveLength(1);
  });

  test("سجل يومية قديم من غير بنود فندق بيشتغل عادي ويقدر الموظف يكتب فيه", async ({ page, env }) => {
    await users(env);
    await env.seedShift("ahmed");
    await env.q("update shift_records set hotel_rows = '[]'::jsonb");
    await page.goto("/");
    await login(page, "ahmed");
    await goTab(page, "اليومية");
    await page.getByTestId("hotel-row-0").getByPlaceholder("مبلغ المصروف").fill("15");
    await page.waitForTimeout(1300);
    const rec = (await env.q("select hotel_rows from shift_records"))[0];
    expect(rec.hotel_rows).toHaveLength(1);
    expect(Number(rec.hotel_rows[0].expenseAmt)).toBe(15);
  });
});

test.describe("سعر الليلة على بلوك الغرفة", () => {
  test("كل غرفة ساكنة عليها سعر ليلتها بعملتها (وغير الساكنة مفيهاش)", async ({ page, env }) => {
    await users(env);
    await env.seedBooking({ room: 601, guest: "In USD", start: 0, nights: 2, price: 100, currency: "USD" });
    await env.seedBooking({ room: 602, guest: "In EGP", start: -1, nights: 3, price: 2500, currency: "EGP" });
    await page.goto("/");
    await login(page, "rawan");
    expect(digits(await page.getByTestId("tile-price-601").innerText())).toBe("100USD/ليلة");
    expect(digits(await page.getByTestId("tile-price-602").innerText())).toBe("2500EGP/ليلة");
    await expect(page.getByTestId("tile-price-603")).toHaveCount(0);
  });
});

test.describe("الحجز الملغي وحالة الفلوس", () => {
  async function cancelViaUi(page, name) {
    await goTab(page, "الحجوزات");
    await guestCard(page, name).locator("button").first().click();
    await openMore(page);
    await page.locator("xpath=//label[contains(.,'الحالة')]/following-sibling::select").selectOption("ملغي");
    await page.getByRole("button", { name: /حفظ الحجز/ }).click();
    await expect(page.locator(".cx-card[data-calma-editing]")).toHaveCount(0);
  }

  test("الحجز الملغي بيفضل ظاهر كـ'حجز ملغي' بوضوح، وبيقول إن مفيش فلوس اترد (مفيش متحصّل)، وفي تصفية للملغي", async ({ page, env }) => {
    await users(env);
    await env.seedBooking({ room: 601, guest: "Unpaid Cancelled", nights: 1, price: 100 });
    await env.seedBooking({ room: 602, guest: "Still Active", nights: 1, price: 100 });
    await page.goto("/");
    await login(page, "rawan");
    await cancelViaUi(page, "Unpaid Cancelled");
    const card = page.getByTestId("booking-cancelled").filter({ hasText: "Unpaid Cancelled" });
    await expect(card).toBeVisible();
    await expect(card).toContainText("حجز ملغي");
    await expect(card.getByTestId("refund-status")).toContainText("ملغي من غير فلوس متحصّلة - مفيش رد مطلوب");
    // التصفية
    await expect(page.getByTestId("status-filter-all")).toContainText("(2)");
    await expect(page.getByTestId("status-filter-cancelled")).toContainText("(1)");
    await page.getByTestId("status-filter-cancelled").click();
    await expect(page.getByText("Unpaid Cancelled").first()).toBeVisible();
    await expect(page.getByText("Still Active")).toHaveCount(0);
    await page.getByTestId("status-filter-active").click();
    await expect(page.getByText("Still Active").first()).toBeVisible();
    await expect(page.getByText("Unpaid Cancelled")).toHaveCount(0);
    // وبعد الإلغاء الغرفة بتبقى متاحة في اللوحة
    await goTab(page, "لوحة الغرف");
    await expect(boardTile(page, 601)).not.toContainText("Unpaid Cancelled");
  });

  test("حجز ملغي ومدفوع: حالة الفلوس بتتغيّر من 'طلب رد معلّق' لـ'اترد للنزيل' أو 'رُفض الرد' وبتفضل ظاهرة", async ({ page, env }) => {
    await users(env);
    const a = await env.seedBooking({ room: 603, guest: "Will Refund", nights: 2, price: 100, paid: 200, settled: true });
    const b = await env.seedBooking({ room: 604, guest: "Will Keep", nights: 1, price: 100, paid: 100, settled: true });
    await env.seedShift("ahmed", { collections: [{ room: 603, amount: 200, bookingId: a }, { room: 604, amount: 100, bookingId: b }] });
    await page.goto("/");
    await login(page, "rawan");
    await cancelViaUi(page, "Will Refund");
    await cancelViaUi(page, "Will Keep");
    // لسه معلّق
    await expect(guestCard(page, "Will Refund").getByTestId("refund-request")).toContainText("طلب رد فلوس");
    // رد
    const r1 = guestCard(page, "Will Refund").getByTestId("refund-request");
    await r1.getByRole("button", { name: "رد الفلوس" }).click();
    await expect(toast(page)).toContainText("تم رد");
    const s1 = guestCard(page, "Will Refund").getByTestId("refund-status");
    await expect(s1).toContainText("اترد للنزيل");
    expect(digits(await s1.innerText())).toContain("200USD");
    await expect(s1).toContainText("rawan");
    await expect(guestCard(page, "Will Refund")).toContainText("حجز ملغي");        // لسه ظاهر بعد الرد
    // رفض
    const r2 = guestCard(page, "Will Keep").getByTestId("refund-request");
    await r2.getByRole("button", { name: /رفض الرد/ }).click();
    await expect(toast(page)).toContainText("تم رفض الرد");
    const s2 = guestCard(page, "Will Keep").getByTestId("refund-status");
    await expect(s2).toContainText("رُفض الرد");
    expect(digits(await s2.innerText())).toContain("100USD");
    // الموظف بيشوف نفس الحالة (للعرض)
    await logout(page);
    await login(page, "ahmed");
    await goTab(page, "الحجوزات");
    await page.getByTestId("status-filter-cancelled").click();
    await expect(guestCard(page, "Will Refund").getByTestId("refund-status")).toContainText("اترد للنزيل");
    await expect(guestCard(page, "Will Keep").getByTestId("refund-status")).toContainText("رُفض الرد");
  });
});
