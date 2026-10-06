// الخروج المبكر والتسكين المكرر من شاشة الحجوزات (موظف الشيفت) فوق قاعدة حقيقية.
import { test, expect } from "../fixtures";
import { login, logout, goTab, field, boardTile, roomCard, toast, digits, cairoDate, addBooking } from "../ui";

async function users(env) {
  await env.seedUser("boss", "gm", "المدير");
  await env.seedUser("ahmed", "staff", "أحمد");
  await env.seedUser("rawan", "reservations", "روان");
}
const get = async (env, name) => (await env.q("select * from bookings where guest_name = $1", [name]))[0];
const ledgerNet = async (env) => (await env.q("select rows from shift_records")).reduce((s, r) => s + r.rows.reduce((a, x) => a + (Number(x.collectionAmt) || 0), 0), 0);

test.describe("تسكين مكرر", () => {
  test("نزيل قديم دخل من يومين (٤ ليالي، مدفوع كامل) يخرج بدري ونزيل جديد ياخد الغرفة", async ({ page, env }) => {
    await users(env);
    const oldId = await env.seedBooking({ room: 611, guest: "Old Guest", start: -2, nights: 4, price: 100, paid: 400, settled: true });
    await env.seedShift("ahmed", { collections: [{ room: 611, amount: 400, bookingId: oldId }] });
    await page.goto("/");
    await login(page, "ahmed");

    await goTab(page, "الحجوزات");
    await page.getByRole("button", { name: /حجز جديد/ }).click();
    await page.locator(".cx-card[data-calma-editing] select.cx-select").first().selectOption("611");
    await field(page, "اسم النزيل").fill("New Guest");
    await field(page, "تاريخ الخروج").fill(cairoDate(2));
    await page.locator("xpath=//label[contains(.,'السعر لليلة')]/following-sibling::div//input[@type='number']").fill("120");

    // تحذير التعارض + من غير تأكيد مفيش حفظ
    await expect(page.getByText(/محجوزة بالفعل في تواريخ متداخلة/)).toBeVisible();
    await page.getByRole("button", { name: /حفظ الحجز/ }).click();
    await expect(toast(page)).toContainText("الغرفة متعارضة مع حجز موجود");
    expect(await env.q("select 1 from bookings")).toHaveLength(1);

    // تأكيد التسكين المكرر: الخطة بتظهر قبل الحفظ
    await page.getByRole("checkbox", { name: /تسكين مكرر/ }).check();
    await expect(page.getByText(/اللي هيحصل عند الحفظ/)).toContainText("غادر مبكرًا");
    await page.getByRole("button", { name: /حفظ الحجز/ }).click();
    await expect(toast(page)).toContainText("تم الحفظ");
    await expect(toast(page)).toContainText("طلب رد فلوس");

    const old = await get(env, "Old Guest");
    expect(old).toMatchObject({ checkout: cairoDate(0), total_room: 200, status: "تم تسجيل الخروج", left_early: true, refund_pending: true, amount_paid: 400, settled: true });
    expect(old.notes).toContain("غادر مبكرًا");
    const nw = await get(env, "New Guest");
    expect(nw).toMatchObject({ room: 611, checkin: cairoDate(0), checkout: cairoDate(2), total_room: 240, duplicate_placement: true, status: "مؤكد", amount_paid: 0, created_by: "ahmed" });

    // لوحة الغرف: الغرفة مشغولة بالنزيل الجديد (متبقي فلوس) + بطاقة "غادر مبكرًا" للقديم
    await goTab(page, "لوحة الغرف");
    await boardTile(page, 611).click();
    await expect(roomCard(page)).toContainText("New Guest");
    await expect(roomCard(page)).toContainText("تسكين مكرر");
    await expect(page.getByText(/Old Guest - غادر النهارده/)).toContainText("طلب رد فلوس");
    await logout(page);

    // مدير الحجوزات يرد الزيادة: ٢٠٠ فقط
    await login(page, "rawan");
    await expect(page.getByTestId("refund-banner")).toContainText("1 طلب رد فلوس");
    await goTab(page, "الحجوزات");
    const req = page.getByTestId("refund-request");
    expect(digits(await req.innerText())).toContain("200USD");
    await req.getByRole("button", { name: "رد الفلوس" }).click();
    await req.getByRole("button", { name: "تأكيد الرد؟" }).click();
    await expect(toast(page)).toContainText("تم رد");
    const after = await get(env, "Old Guest");
    expect(after).toMatchObject({ amount_paid: 200, refund_pending: false, refund_decision: "refunded", refunded_amount: 200, settled: true });
    expect(await ledgerNet(env)).toBe(200);          // ٤٠٠ تحصيل - ٢٠٠ رد
  });

  test("خروج في نفس يوم الدخول: بيتحاسب ليلة واحدة والباقي طلب رد", async ({ page, env }) => {
    await users(env);
    await env.seedBooking({ room: 612, guest: "Same Day", start: 0, nights: 2, price: 100, paid: 200, settled: true });
    await env.seedShift("ahmed");
    await page.goto("/");
    await login(page, "ahmed");
    await goTab(page, "الحجوزات");
    await page.getByRole("button", { name: /حجز جديد/ }).click();
    await page.locator(".cx-card[data-calma-editing] select.cx-select").first().selectOption("612");
    await field(page, "اسم النزيل").fill("Replacement");
    await field(page, "تاريخ الخروج").fill(cairoDate(1));
    await page.locator("xpath=//label[contains(.,'السعر لليلة')]/following-sibling::div//input[@type='number']").fill("100");
    await page.getByRole("checkbox", { name: /تسكين مكرر/ }).check();
    await expect(page.getByText(/دخل .* وخرج في نفس اليوم/)).toBeVisible();
    await page.getByRole("button", { name: /حفظ الحجز/ }).click();
    await expect(toast(page)).toContainText("تم الحفظ");
    const old = await get(env, "Same Day");
    expect(old).toMatchObject({ checkin: cairoDate(0), checkout: cairoDate(0), total_room: 100, left_early: true, status: "تم تسجيل الخروج", refund_pending: true });
    expect(await get(env, "Replacement")).toMatchObject({ duplicate_placement: true, checkin: cairoDate(0) });
  });

  test("حجز قديم مستقبلي (مش خروج مبكر): التسكين المكرر مرفوض وبرسالة، ومفيش حاجة بتتغيّر", async ({ page, env }) => {
    await users(env);
    await env.seedBooking({ room: 613, guest: "Future Booking", start: 1, nights: 3, price: 100 });
    await env.seedShift("ahmed");
    await page.goto("/");
    await login(page, "ahmed");
    await goTab(page, "الحجوزات");
    await page.getByRole("button", { name: /حجز جديد/ }).click();
    await page.locator(".cx-card[data-calma-editing] select.cx-select").first().selectOption("613");
    await field(page, "اسم النزيل").fill("Intruder");
    await field(page, "تاريخ الدخول").fill(cairoDate(2));
    await field(page, "تاريخ الخروج").fill(cairoDate(3));
    await expect(page.getByText(/لسه ماجاش معاده/)).toBeVisible();
    await expect(page.getByRole("checkbox", { name: /تسكين مكرر/ })).toBeDisabled();
    await page.getByRole("button", { name: /حفظ الحجز/ }).click();
    expect(await env.q("select 1 from bookings")).toHaveLength(1);
  });

  test("حجز جديد بيبدأ في المستقبل والنزيل القديم لسه في الغرفة: مرفوض (مدير الحجوزات يعدّل خروج القديم الأول)", async ({ page, env }) => {
    await users(env);
    await env.seedBooking({ room: 614, guest: "Still Here", start: -1, nights: 4, price: 100 });
    await env.seedShift("ahmed");
    await page.goto("/");
    await login(page, "ahmed");
    await goTab(page, "الحجوزات");
    await page.getByRole("button", { name: /حجز جديد/ }).click();
    await page.locator(".cx-card[data-calma-editing] select.cx-select").first().selectOption("614");
    await field(page, "اسم النزيل").fill("Early Bird");
    await field(page, "تاريخ الدخول").fill(cairoDate(1));
    await field(page, "تاريخ الخروج").fill(cairoDate(2));
    await expect(page.getByText(/نزيله لسه في الغرفة/)).toBeVisible();
    await expect(page.getByRole("checkbox", { name: /تسكين مكرر/ })).toBeDisabled();
  });

  test("مدير الحجوزات يعدّل خروج النزيل القديم الأول، وبعدها الحجز الجديد يتحفظ عادي من غير تسكين مكرر", async ({ page, env }) => {
    await users(env);
    await env.seedBooking({ room: 615, guest: "Leaves Tomorrow", start: -1, nights: 4, price: 100 });
    await page.goto("/");
    await login(page, "rawan");
    await goTab(page, "الحجوزات");
    await page.locator(".cx-card", { hasText: "Leaves Tomorrow" }).last().locator("button").first().click();
    await field(page, "تاريخ الخروج").fill(cairoDate(1));
    await page.getByRole("button", { name: /حفظ الحجز/ }).click();
    await expect(toast(page)).toContainText("تم الحفظ");
    await addBooking(page, { room: 615, guest: "Arrives Tomorrow", startOffset: 1, nights: 2, price: 90 });
    const nw = await get(env, "Arrives Tomorrow");
    expect(nw).toMatchObject({ room: 615, duplicate_placement: false, checkin: cairoDate(1) });
    expect((await get(env, "Leaves Tomorrow")).left_early).toBe(false);
  });

  test("فشل حفظ الحجز الجديد بعد تقصير القديم: القديم بيرجع زي ما كان (rollback)", async ({ page, env }) => {
    await users(env);
    const oldId = await env.seedBooking({ room: 616, guest: "Rollback Old", start: -2, nights: 4, price: 100, paid: 0 });
    await env.seedShift("ahmed");
    await page.goto("/");
    await login(page, "ahmed");
    // نخلّي إدخال الحجز الجديد (POST /bookings) يفشل بعد ما التقصير يتنفّذ
    await page.route(/fake-supabase\.test\/rest\/v1\/bookings(\?|$)/, async (route) => {
      if (route.request().method() === "POST") return route.fulfill({ status: 500, headers: { "access-control-allow-origin": "*", "content-type": "application/json" }, body: JSON.stringify({ message: "boom", code: "XX000" }) });
      return route.fallback();
    });
    await goTab(page, "الحجوزات");
    await page.getByRole("button", { name: /حجز جديد/ }).click();
    await page.locator(".cx-card[data-calma-editing] select.cx-select").first().selectOption("616");
    await field(page, "اسم النزيل").fill("Will Fail");
    await field(page, "تاريخ الخروج").fill(cairoDate(1));
    await page.locator("xpath=//label[contains(.,'السعر لليلة')]/following-sibling::div//input[@type='number']").fill("100");
    await page.getByRole("checkbox", { name: /تسكين مكرر/ }).check();
    await page.getByRole("button", { name: /حفظ الحجز/ }).click();
    await expect(toast(page)).toContainText("الحجز القديم رجع زي ما كان");
    const old = (await env.q("select * from bookings where id = $1", [oldId]))[0];
    expect(old).toMatchObject({ checkout: cairoDate(2), total_room: 400, left_early: false, status: "مؤكد", refund_pending: false });
    expect(old.pre_early_checkout).toBeNull();
    expect(await env.q("select 1 from bookings where guest_name = 'Will Fail'")).toHaveLength(0);
  });
});

test.describe("خروج مبكر من لوحة الغرف", () => {
  test("الموظف يعلّم غرفة عليها نزيل 'غادر مبكرًا' (حالة يدوية) وبتظهر في اللوحة، وباقي الحالات ممنوعة له", async ({ page, env }) => {
    await users(env);
    await env.seedBooking({ room: 601, guest: "Occupant", start: 0, nights: 2, price: 100 });
    await env.seedShift("ahmed");
    await page.goto("/");
    await login(page, "ahmed");
    await goTab(page, "لوحة الغرف");
    await boardTile(page, 601).click();
    await expect(page.getByText(/تغيير حالتها بشكل عام يتم من مدير الحجوزات فقط/)).toBeVisible();
    await expect(page.getByRole("button", { name: "صيانة" })).toHaveCount(0);
    await page.getByRole("button", { name: "غادر مبكرًا" }).click();
    await expect(toast(page)).toContainText("تم تحديث حالة الغرفة");
    const [ov] = await env.q("select * from room_overrides where room_number = 601");
    expect(ov).toMatchObject({ status: "early_checkout", updated_by: "ahmed" });
    await expect(page.getByText(/غادر مبكرًا 1/)).toBeVisible();
  });
});
