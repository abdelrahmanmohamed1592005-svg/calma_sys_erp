// فورم الحجز بتفاصيله (تحقق، رسوم، أونلاين، تنضيف، بحث...) فوق قاعدة بيانات حقيقية.
import { test, expect } from "../fixtures";
import { login, goTab, field, boardTile, roomCard, toast, digits, cairoDate, addBooking, openRoom } from "../ui";

async function users(env) {
  await env.seedUser("boss", "gm", "المدير");
  await env.seedUser("ahmed", "staff", "أحمد");
  await env.seedUser("rawan", "reservations", "روان");
}
const openForm = async (page) => { await goTab(page, "الحجوزات"); await page.getByRole("button", { name: /حجز جديد/ }).click(); return page.locator(".cx-card[data-calma-editing]"); };
const priceInput = (page) => page.locator("xpath=//label[contains(.,'السعر لليلة')]/following-sibling::div//input[@type='number']");
const settledBox = (page) => page.locator("xpath=//span[contains(.,'تم تحصيل كامل المبلغ')]/preceding-sibling::input[@type='checkbox']");
const save = (page) => page.getByRole("button", { name: /حفظ الحجز/ }).click();
const bk = async (env, guest) => (await env.q("select * from bookings where guest_name = $1", [guest]))[0];
const asStaff = async (page, env) => { await users(env); await env.seedShift("ahmed"); await page.goto("/"); await login(page, "ahmed"); };

test.describe("التحقق من المدخلات", () => {
  test("بيانات ناقصة أو غلط بتترفض برسالة، ومفيش حاجة بتتبعت لقاعدة البيانات", async ({ page, env }) => {
    await asStaff(page, env);
    const form = await openForm(page);
    await save(page);
    await expect(toast(page)).toContainText("لازم تحدد الغرفة واسم النزيل");

    await form.locator("select.cx-select").first().selectOption("601");
    await field(page, "اسم النزيل").fill("Validator");
    await priceInput(page).fill("-50");
    await save(page);
    await expect(toast(page)).toContainText("إجمالي الغرفة لازم يكون رقم صحيح مش سالب");

    await priceInput(page).fill("100");
    await page.locator("xpath=//label[contains(.,'المدفوع حتى الآن')]/following-sibling::input").fill("-5");
    await save(page);
    await expect(toast(page)).toContainText("المدفوع لازم يكون رقم صحيح مش سالب");

    await page.locator("xpath=//label[contains(.,'المدفوع حتى الآن')]/following-sibling::input").fill("");
    await field(page, "تاريخ الخروج").fill(cairoDate(-1));
    await save(page);
    await expect(toast(page)).toContainText("تاريخ الخروج لازم يكون بعد تاريخ الدخول");
    expect(await env.q("select 1 from bookings")).toHaveLength(0);
  });

  test("تغيير تاريخ الدخول بيزق الخروج تلقائي، والإجمالي بيتحسب بعدد الليالي", async ({ page, env }) => {
    await asStaff(page, env);
    await openForm(page);
    await field(page, "تاريخ الدخول").fill(cairoDate(5));
    await expect(field(page, "تاريخ الخروج")).toHaveValue(cairoDate(6));
    await field(page, "تاريخ الخروج").fill(cairoDate(8));
    await priceInput(page).fill("70");
    expect(digits(await page.locator(".cx-card[data-calma-editing]").innerText())).toContain("الإجماليالكلي(غرفة+رسوم)210USD");
  });

  test("أرقام وحقول حرة: العدد بيتصحّح، والنصوص بتتنضّف وتتقصّ بطول أقصى", async ({ page, env }) => {
    await asStaff(page, env);
    const form = await openForm(page);
    await form.locator("select.cx-select").first().selectOption("602");
    await field(page, "اسم النزيل").fill("  X\u0007\u0008" + "y".repeat(300) + "  ");
    await field(page, "الهاتف").fill("0".repeat(100));
    await field(page, "عدد الأفراد").fill("2.7");
    await priceInput(page).fill("40");
    await page.locator("xpath=//label[contains(.,'ملاحظات')]/following-sibling::input").fill("n".repeat(1500));
    await save(page);
    await expect(toast(page)).toContainText("تم الحفظ");
    const b = (await env.q("select * from bookings"))[0];
    expect(b.guest_name).toBe("X" + "y".repeat(119));
    expect(b.guest_name).not.toMatch(/[\u0000-\u001f]/);
    expect(b.phone).toHaveLength(40);
    expect(b.notes).toHaveLength(1000);
    expect(b.pax).toBe(2);
    const form2 = await openForm(page);
    await form2.locator("select.cx-select").first().selectOption("603");
    await field(page, "اسم النزيل").fill("Zero Pax");
    await field(page, "عدد الأفراد").fill("0");
    await priceInput(page).fill("10");
    await save(page);
    await expect(toast(page)).toContainText("تم الحفظ");
    expect((await bk(env, "Zero Pax")).pax).toBe(1);
  });
});

test.describe("الرسوم وطرق الدفع", () => {
  test("دخول مبكر برسم: بيدخل في الإجمالي والمتبقي والتحصيل من لوحة الغرف", async ({ page, env }) => {
    await asStaff(page, env);
    const form = await openForm(page);
    await form.locator("select.cx-select").first().selectOption("604");
    await field(page, "اسم النزيل").fill("Early Bird");
    await field(page, "تاريخ الخروج").fill(cairoDate(2));
    await priceInput(page).fill("100");
    await page.getByRole("checkbox", { name: /دخول مبكر قبل معاد الحجز الأصلي/ }).check();
    await field(page, "رسم الدخول المبكر").fill("30");
    await field(page, "ملاحظة الدخول المبكر").fill("وصل الفجر");
    expect(digits(await form.innerText())).toContain("الإجماليالكلي(غرفة+رسوم)230USD");
    await save(page);
    await expect(toast(page)).toContainText("تم الحفظ");
    expect(await bk(env, "Early Bird")).toMatchObject({ total_room: 200, early_checkin: { applied: true, fee: 30, note: "وصل الفجر" } });
    await goTab(page, "لوحة الغرف");
    await openRoom(page, 604);
    expect(digits(await roomCard(page).innerText())).toMatch(/المتبقي230USD/);
    await expect(roomCard(page)).toContainText("ملاحظة الدخول المبكر: وصل الفجر");
    await roomCard(page).getByRole("button", { name: /تسجيل تحصيل كامل المبلغ/ }).click();
    await expect(toast(page)).toContainText("تم تسجيل التحصيل الكامل");
    expect((await bk(env, "Early Bird")).amount_paid).toBe(230);
  });

  test("حجز مدفوع أونلاين من مدير الحجوزات: بدون متبقي ولا وسيلة دفع ولا عمولة، الغرفة متحصّلة، وبيظهر في التقرير بإجماليه", async ({ page, env }) => {
    await users(env);
    await page.goto("/");
    await login(page, "rawan");
    const form = await openForm(page);
    await form.locator("select.cx-select").first().selectOption("605");
    await field(page, "اسم النزيل").fill("Booking Guest");
    await field(page, "تاريخ الخروج").fill(cairoDate(2));
    await priceInput(page).fill("100");
    await page.locator("xpath=//label[contains(.,'جهة الحجز')]/following-sibling::select").selectOption("Booking.com");
    await page.getByRole("checkbox", { name: /الحجز مدفوع أونلاين/ }).check();
    await expect(page.locator("xpath=//label[contains(.,'طريقة الدفع')]")).toHaveCount(0);       // وسيلة الدفع اتشالت
    await expect(page.getByText(/عمولة/)).toHaveCount(0);                                           // ولا فيه عمولة
    await field(page, "رقم تأكيد الحجز على المنصة / ملاحظة (اختياري)").fill("BK-777");
    expect(digits(await form.innerText())).toContain("إجماليالحجزالأونلاين200USD");
    await save(page);
    await expect(toast(page)).toContainText("تم الحفظ");
    const b = await bk(env, "Booking Guest");
    expect(b).toMatchObject({ source: "Booking.com", amount_paid: 0 });
    expect(b.payment_details).toMatchObject({ onlinePaid: true, ref: "BK-777" });
    expect(b.payment_details).not.toHaveProperty("commissionPct");
    await goTab(page, "لوحة الغرف");
    await expect(page.getByText(/مشغولة - متحصّلة 1/)).toBeVisible();
    await openRoom(page, 605);
    await expect(roomCard(page)).toContainText("مدفوع أونلاين");
    expect(digits(await roomCard(page).innerText())).not.toMatch(/المتبقي\d/);
    await goTab(page, "التقارير");
    const online = digits(await page.locator(".cx-card", { hasText: "الحجوزات الأونلاين" }).last().innerText());
    expect(online).toContain("إجماليالحجوزاتالأونلاين200$");
    expect(online).not.toContain("العمولة");
    expect(online).toContain("BK-777");
  });

  test("فيزا بتفاصيل التحويل، ويتحصّل مقدّم وقت الحجز فيتسجّل في اليومية تلقائي", async ({ page, env }) => {
    await asStaff(page, env);
    const form = await openForm(page);
    await form.locator("select.cx-select").first().selectOption("606");
    await field(page, "اسم النزيل").fill("Visa Guest");
    await field(page, "تاريخ الخروج").fill(cairoDate(2));
    await priceInput(page).fill("100");
    await page.locator("xpath=//label[contains(.,'طريقة الدفع')]/following-sibling::select").selectOption("فيزا");
    await page.getByPlaceholder("اسم المرسل").fill("John Visa");
    await page.getByPlaceholder("آخر ٤ أرقام الكارت").fill("4242");
    await page.locator("xpath=//label[contains(.,'المدفوع حتى الآن')]/following-sibling::input").fill("120");
    expect(digits(await form.innerText())).toContain("المتبقيعلىالنزيل80USD");
    await expect(settledBox(page)).toBeDisabled();
    await save(page);
    await expect(toast(page)).toContainText("تم الحفظ");
    const b = await bk(env, "Visa Guest");
    expect(b).toMatchObject({ payment_method: "فيزا", amount_paid: 120, settled: false });
    expect(b.payment_details).toMatchObject({ senderName: "John Visa", senderNumber: "4242" });
    const [rec] = await env.q("select rows, booking_collections from shift_records");
    const row = rec.rows.find((r) => r.room === 606);
    expect(row).toMatchObject({ collectionAmt: 120, collectionMethod: "فيزا", collectionCurrency: "USD" });
    expect(rec.booking_collections).toHaveLength(1);
    expect(rec.booking_collections[0].bookingId).toBe(b.id);
  });

  test("كاش: المبلغ المستلم والباقي (الفكة)، وتعليم متحصّل لما المدفوع يغطّي الإجمالي", async ({ page, env }) => {
    await asStaff(page, env);
    const form = await openForm(page);
    await form.locator("select.cx-select").first().selectOption("607");
    await field(page, "اسم النزيل").fill("Cash Guest");
    await priceInput(page).fill("150");
    await page.locator("xpath=//label[contains(.,'المدفوع حتى الآن')]/following-sibling::input").fill("150");
    await page.locator("xpath=//label[contains(.,'المبلغ المُستلم نقدًا')]/following-sibling::input").fill("200");
    expect(digits(await form.innerText())).toContain("الباقي(الفكة)50USD");
    await settledBox(page).check();
    await save(page);
    await expect(toast(page)).toContainText("تم الحفظ");
    expect(await bk(env, "Cash Guest")).toMatchObject({ amount_paid: 150, amount_tendered: 200, settled: true });
  });

  test("عملات مختلفة: حجز بيورو وآخر بجنيه، وكل واحد بعملته في البطاقة", async ({ page, env }) => {
    await asStaff(page, env);
    await addBooking(page, { room: 608, guest: "Euro Guest", price: 80, nights: 2, currency: "EUR" });
    await addBooking(page, { room: 609, guest: "Pound Guest", price: 900, nights: 1, currency: "EGP" });
    expect(await bk(env, "Euro Guest")).toMatchObject({ currency: "EUR", total_room: 160 });
    expect(await bk(env, "Pound Guest")).toMatchObject({ currency: "EGP", total_room: 900 });
    await goTab(page, "لوحة الغرف");
    await openRoom(page, 608);
    expect(digits(await roomCard(page).innerText())).toContain("160EUR");
    await openRoom(page, 609);
    expect(digits(await roomCard(page).innerText())).toContain("900EGP");
    // تحصيل بعملة الحجز: الصف في اليومية بعملة الحجز
    await roomCard(page).getByRole("button", { name: /تسجيل تحصيل كامل المبلغ/ }).click();
    await expect(toast(page)).toContainText("تم تسجيل التحصيل الكامل");
    const [rec] = await env.q("select rows from shift_records");
    expect(rec.rows.find((r) => r.room === 609)).toMatchObject({ collectionAmt: 900, collectionCurrency: "EGP" });
  });
});

test.describe("البحث والتصفية في قائمة الحجوزات", () => {
  test("بحث بالاسم (من غير حساسية لحالة الحروف) والغرفة والكود، وتصفية بالتاريخ", async ({ page, env }) => {
    await users(env);
    await env.seedBooking({ room: 601, guest: "Ali Hassan", start: 0, nights: 2 });
    await env.seedBooking({ room: 602, guest: "Mona Salem", start: 10, nights: 2 });
    await env.seedBooking({ room: 603, guest: "Omar Fathy", start: -20, nights: 2 });
    await env.q("update bookings set code = 'ABC-123' where guest_name = 'Omar Fathy'");
    await page.goto("/");
    await login(page, "rawan");
    await goTab(page, "الحجوزات");
    const names = async () => (await page.locator(".cx-card >> text=/Ali Hassan|Mona Salem|Omar Fathy/").allInnerTexts()).join("|");
    const search = page.getByPlaceholder("بحث برقم الغرفة أو الاسم أو الكود");
    await search.fill("ali");
    await expect(page.getByText("Ali Hassan").first()).toBeVisible();
    await expect(page.getByText("Mona Salem")).toHaveCount(0);
    await search.fill("602");
    await expect(page.getByText("Mona Salem").first()).toBeVisible();
    await expect(page.getByText("Ali Hassan")).toHaveCount(0);
    await search.fill("abc-123");
    await expect(page.getByText("Omar Fathy").first()).toBeVisible();
    await expect(page.getByText("Ali Hassan")).toHaveCount(0);
    await search.fill("");
    // الفترة: النهارده → +٣ بس بتجيب علي
    await page.locator('input[type="date"]').nth(0).fill(cairoDate(0));
    await page.locator('input[type="date"]').nth(1).fill(cairoDate(3));
    await expect(page.getByText("Ali Hassan").first()).toBeVisible();
    await expect(page.getByText("Mona Salem")).toHaveCount(0);
    await expect(page.getByText("Omar Fathy")).toHaveCount(0);
    await page.getByRole("button", { name: "مسح الفترة" }).click();
    await expect(page.getByText("Omar Fathy").first()).toBeVisible();
  });
});
