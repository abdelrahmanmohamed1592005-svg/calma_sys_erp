// الوقت (الأوفر تايم، منتصف الليل، الشيفت الليلي) وأعطال الشبكة/السيرفر وسط العمليات.
import { test, expect } from "../fixtures";
import { login, logout, goTab, field, boardTile, roomCard, toast, digits, cairoDate, addBooking, setCairoTime, SHIFT_LABEL, refresh, openRoom, showAllRooms, payOnBoard, waitLedgerSaved } from "../ui";

async function users(env) {
  await env.seedUser("boss", "gm", "المدير");
  await env.seedUser("ahmed", "staff", "أحمد");
  await env.seedUser("sara", "staff", "سارة");
  await env.seedUser("rawan", "reservations", "روان");
}
const rec = async (env, who) => (await env.q("select * from shift_records where staff_username = $1", [who]))[0];
const today = () => cairoDate(0);
const yesterday = () => cairoDate(-1);

test.describe("الأوفر تايم", () => {
  test("مفيش قفل بالساعة: بعد معاد الشيفت بكتير (حتى بعد نص الليل) الشيفت فاضل مفتوح والموظف بيعدّل ويحصّل لحد ما يقفله بنفسه", async ({ page, env }) => {
    await users(env);
    await env.seedBooking({ room: 601, guest: "Overtime Guest", nights: 1, price: 100 });
    await env.seedShift("ahmed", { key: "morning", day: today() });

    // 17:30 (بعد نهاية الصباحي)
    await setCairoTime(page, 17, 30);
    await page.goto("/");
    await login(page, "ahmed");
    await goTab(page, "اليومية"); await showAllRooms(page);
    await page.locator("table.cx-table tbody tr", { hasText: "602" }).first().getByPlaceholder("المبلغ").fill("15");
    await waitLedgerSaved(page);
    expect(Number((await rec(env, "ahmed")).rows.find((r) => r.room === 602).collectionAmt)).toBe(15);

    // 23:30: لسه مفتوح ومفيش إقفال تلقائي
    await setCairoTime(page, 23, 30);
    await page.reload();
    await goTab(page, "لوحة الغرف");
    await openRoom(page, 601);
    await payOnBoard(page);
    await expect(toast(page)).toContainText("الحجز مدفوع بالكامل");
    const r = await rec(env, "ahmed");
    expect(r.closed).toBe(false);
    await goTab(page, "اليومية"); await showAllRooms(page);
    await expect(page.locator("table.cx-table tbody tr", { hasText: "603" }).first().getByPlaceholder("المبلغ")).toBeEnabled();
    await goTab(page, "الحجوزات");
    await expect(page.getByRole("button", { name: /حجز جديد/ })).toHaveCount(1);
    expect((await env.q("select count(*)::int n from activity_log where action like '%إقفال تلقائي%'"))[0].n).toBe(0);
  });

  test("الشيفت المسائي بعد منتصف الليل (00:30): لسه أوفر تايم على يوم الشيفت اللي قبل نص الليل، والتحصيل بيتسجّل عليه", async ({ page, env }) => {
    await users(env);
    await env.seedBooking({ room: 602, guest: "Midnight Guest", start: 0, nights: 1, price: 100 });
    await env.seedShift("ahmed", { key: "evening", day: yesterday() });
    await setCairoTime(page, 0, 30);
    await page.goto("/");
    await login(page, "ahmed");
    await goTab(page, "لوحة الغرف");
    await openRoom(page, 602);
    await payOnBoard(page);
    await expect(toast(page)).toContainText("الحجز مدفوع بالكامل");
    const r = await rec(env, "ahmed");
    expect(r).toMatchObject({ date: yesterday(), shift_key: "evening", closed: false });
    expect(Number(r.rows.find((x) => x.room === 602).collectionAmt)).toBe(100);
    // 02:30: مفيش قفل بالساعة - لسه شغّال على نفس الشيفت
    await setCairoTime(page, 2, 30);
    await page.reload();
    await goTab(page, "لوحة الغرف");
    await openRoom(page, 603);
    await expect(page.getByText(/مش شيفتك دلوقتي/)).toHaveCount(0);
    expect((await rec(env, "ahmed")).closed).toBe(false);
  });
});

test("غادر مبكرًا بعد نص الليل (00:30): الزرار ظاهر لموظف المسائي والنزيل بيتحاسب على الليالي اللي قعدها", async ({ page, env }) => {
  await users(env);
  const b = await env.seedBooking({ room: 602, guest: "Night Leaver", start: -1, nights: 3, price: 100, currency: "EGP" });
  await env.seedShift("ahmed", { key: "evening", day: yesterday() });
  await setCairoTime(page, 0, 30);
  await page.goto("/");
  await login(page, "ahmed");
  await goTab(page, "لوحة الغرف");
  await openRoom(page, 602);
  await page.getByTestId("early-leave").getByRole("button").first().click();
  await page.getByTestId("early-leave").getByRole("button", { name: /تأكيد/ }).click();
  await expect(toast(page)).toContainText("اتحاسب على 1 ليلة من 3");
  expect((await env.q("select checkout::text, left_early from bookings where id = $1", [b]))[0]).toEqual({ checkout: today(), left_early: true });
});

test("نزيل خروجه النهارده ومشي بعد نص الليل: زرار 'النزيل خرج' بيسجّل خروجه والغرفة بتفضى والحساب زي ما هو", async ({ page, env }) => {
  await users(env);
  const b = await env.seedBooking({ room: 608, guest: "Leaves Tonight", start: -1, nights: 1, price: 1800, paid: 1800, currency: "EGP" });
  await env.seedShift("ahmed", { key: "evening", day: yesterday() });
  await setCairoTime(page, 1, 0);
  await page.goto("/");
  await login(page, "ahmed");
  await goTab(page, "لوحة الغرف");
  await openRoom(page, 608);
  await expect(page.getByTestId("early-leave")).toHaveCount(0);        // خروجه النهارده - مش "مبكر"
  await page.getByTestId("checkout-now").getByRole("button").first().click();
  await page.getByTestId("checkout-now").getByRole("button", { name: /تأكيد/ }).click();
  await expect(toast(page)).toContainText("الغرفة فضيت");
  expect((await env.q("select status, checkout::text, total_room::float, left_early from bookings where id = $1", [b]))[0]).toEqual({ status: "تم تسجيل الخروج", checkout: today(), total_room: 1800, left_early: false });
});

test.describe("تبديل الشيفتات والشيفت الليلي", () => {
  test("الموظف المسائي يبدأ 17:00: الصباحي (لسه مفتوح) بيتقفل تلقائي وعهدته بتتنقل", async ({ page, env }) => {
    await users(env);
    await env.seedShift("sara", { key: "morning", day: today(), collections: [{ room: 601, amount: 250, method: "كاش", currency: "EGP" }] });
    await setCairoTime(page, 17, 0);
    await page.goto("/");
    await login(page, "ahmed");
    await goTab(page, "اليومية"); await showAllRooms(page);
    await expect(page.getByRole("button", { name: new RegExp(SHIFT_LABEL.morning) })).toBeDisabled();
    await page.getByRole("button", { name: new RegExp(SHIFT_LABEL.evening) }).click();
    await expect(page.getByText("شيفتك الوحيد المتاح ليك النهارده")).toBeVisible();
    const sara = await rec(env, "sara");
    expect(sara).toMatchObject({ closed: true });
    expect(sara.closed_by).toContain("إقفال تلقائي");
    expect((await rec(env, "ahmed")).handover).toEqual({ EGP: 250 });
  });

  test("الشيفت الليلي 02:00: بيتسجّل على يوم المسائي اللي قبله، والحجز والتحصيل بيروحوا ليومية الليلي، والتقرير بيعرضه", async ({ page, env }) => {
    await users(env);
    await setCairoTime(page, 2, 0);
    await page.goto("/");
    await login(page, "ahmed");
    await goTab(page, "اليومية"); await showAllRooms(page);
    await page.getByRole("button", { name: new RegExp(SHIFT_LABEL.night) }).click();
    await expect(page.getByText("شيفتك الوحيد المتاح ليك النهارده")).toBeVisible();
    expect(await env.q("select date, shift_key from shift_claims")).toEqual([{ date: yesterday(), shift_key: "night" }]);
    await addBooking(page, { room: 604, guest: "Night Owl", price: 100, nights: 1, paid: 100, method: "كاش" });
    const r = await rec(env, "ahmed");
    expect(r).toMatchObject({ date: yesterday(), shift_key: "night" });
    expect(Number(r.rows.find((x) => x.room === 604).collectionAmt)).toBe(100);
    const [b] = await env.q("select checkin, checkout from bookings");
    expect(b).toEqual({ checkin: today(), checkout: cairoDate(1) });      // الحجز بتاريخ التقويم العادي
    await logout(page);
    await login(page, "rawan");
    await goTab(page, "التقارير");
    await expect(page.locator(".cx-report-grid").first()).toContainText("إجمالي التحصيل");
    expect(digits(await page.locator(".cx-report-grid .cx-card", { hasText: "إجمالي التحصيل" }).first().innerText())).toContain("100$");
  });
});

test.describe("أعطال الشبكة والسيرفر", () => {
  test("فشل تسجيل التحصيل في السيرفر: العملية ذرية - مفيش حاجة بتتسجّل لا على الحجز ولا في اليومية، ورسالة الخطأ ظاهرة", async ({ page, env }) => {
    await users(env);
    const id = await env.seedBooking({ room: 601, guest: "Partial Failure", nights: 1, price: 100 });
    await env.seedShift("ahmed");
    await page.goto("/");
    await login(page, "ahmed");
    await goTab(page, "لوحة الغرف");
    await openRoom(page, 601);
    await page.route(/fake-supabase\.test\/rest\/v1\/rpc\/record_booking_payment/, async (route) =>
      route.fulfill({ status: 500, headers: { "access-control-allow-origin": "*", "content-type": "application/json" }, body: JSON.stringify({ message: "boom", code: "XX000" }) }));
    await payOnBoard(page);
    await expect(toast(page)).toContainText("boom");
    const [b] = await env.q("select amount_paid, settled from bookings where id = $1", [id]);
    expect(b).toEqual({ amount_paid: 0, settled: false });
    expect((await rec(env, "ahmed")).booking_collections).toHaveLength(0);
  });

  test("فشل حفظ حجز جديد (500): الفورم يفضل مفتوح بالبيانات ورسالة الخطأ ظاهرة ومفيش حجز نص-نص", async ({ page, env }) => {
    await users(env);
    await env.seedShift("ahmed");
    await page.goto("/");
    await login(page, "ahmed");
    await page.route(/fake-supabase\.test\/rest\/v1\/bookings(\?|$)/, async (route) => {
      if (route.request().method() === "POST") return route.fulfill({ status: 500, headers: { "access-control-allow-origin": "*", "content-type": "application/json" }, body: JSON.stringify({ message: "تعذر الحفظ مؤقتًا", code: "XX000" }) });
      return route.fallback();
    });
    await addBooking(page, { room: 601, guest: "Will Not Save", price: 100, expectSaved: false });
    await expect(toast(page)).toContainText("تعذر الحفظ مؤقتًا");
    await expect(page.locator(".cx-card[data-calma-editing]")).toBeVisible();
    await expect(field(page, "اسم النزيل")).toHaveValue("Will Not Save");
    expect(await env.q("select 1 from bookings")).toHaveLength(0);
  });

  test("الإنترنت فصل أثناء تحميل البيانات: التطبيق مبيبوّظش ومبيعتبرش الحجوزات فاضية (فحص التعارض يفضل سليم)", async ({ page, env }) => {
    await users(env);
    await env.seedShift("ahmed");
    await env.seedBooking({ room: 601, guest: "Existing", start: 0, nights: 2, price: 100 });
    await page.goto("/");
    await login(page, "ahmed");
    await goTab(page, "لوحة الغرف");
    await expect(page.getByText(/مشغولة - متبقي فلوس 1/)).toBeVisible();
    // أي قراءة للحجوزات بتفشل من هنا
    await page.route(/fake-supabase\.test\/rest\/v1\/bookings(\?|$)/, (route) => (route.request().method() === "GET" ? route.abort("connectionfailed") : route.fallback()));
    await refresh(page);
    await expect(page.getByText(/مشغولة - متبقي فلوس 1/)).toBeVisible();        // آخر بيانات سليمة لسه معروضة
    await goTab(page, "الحجوزات");
    await page.getByRole("button", { name: /حجز جديد/ }).click();
    await page.locator(".cx-card[data-calma-editing] select.cx-select").first().selectOption("601");
    await expect(page.getByTestId("duplicate-plan")).toBeVisible();   // التعارض لسه بيتكشف
  });
});

test.describe("الحجز الملغي مبيعطّلش الغرفة", () => {
  test("حجز ملغي في الأيام الجاية مايمنعش تمديد حجز ولا حجز جديد على نفس الغرفة", async ({ page, env }) => {
    await users(env);
    await env.seedShift("ahmed");
    const cur = await env.seedBooking({ room: 601, guest: "Current", start: 0, nights: 1, price: 100 });
    await env.seedBooking({ room: 601, guest: "Cancelled Next", start: 1, nights: 2, price: 100, status: "ملغي" });
    await page.goto("/");
    await login(page, "ahmed");
    await goTab(page, "لوحة الغرف");
    await openRoom(page, 601);
    await roomCard(page).getByRole("button", { name: /تمديد الحجز/ }).click();
    await expect(toast(page)).toContainText("تم تمديد الحجز");
    expect((await env.q("select checkout from bookings where id = $1", [cur]))[0].checkout).toBe(cairoDate(2));
    await addBooking(page, { room: 601, guest: "On Cancelled Dates", startOffset: 3, nights: 1, price: 90 });
    expect(await env.q("select 1 from bookings where guest_name = 'On Cancelled Dates'")).toHaveLength(1);
  });
});

test.describe("تمديد بعد معاد الخروج", () => {
  test("معاد الخروج 2 الضهر: الساعة 1:40 النزيل لسه في الغرفة، بيتمدّد ويدفع التمديد بأكتر من وسيلة وعملة في نفس المرة، وبعد 2 الغرفة بتفضى", async ({ page, env }) => {
    await users(env);
    const b = await env.seedBooking({ room: 611, guest: "Late Leaver", start: -2, nights: 2, price: 300, paid: 600, currency: "EGP" });
    await env.seedShift("ahmed", { key: "morning", day: today() });
    await setCairoTime(page, 13, 40);
    await page.goto("/");
    await login(page, "ahmed");
    await openRoom(page, 611);
    await expect(page.getByTestId("departing-today")).toContainText("2 الضهر");
    await expect(page.getByTestId("checkout-now")).toHaveCount(1);         // ممكن يتسجّل خروجه لو مشي قبل 1
    // تمديد ليلة (300) ودفعها في نفس المرة: 100 كاش + 50 فيزا + 3 دولار بسعر 50 (= 150 جنيه)
    await page.getByTestId("extend-pay-add").click();
    await page.getByTestId("extend-pay-amount-0").fill("100");
    await page.getByTestId("extend-pay-add").click();
    await page.getByTestId("extend-pay-amount-1").fill("50");
    await page.getByTestId("extend-pay-method-1").selectOption("فيزا");
    await page.getByTestId("extend-pay-1-last4").fill("4321");
    await page.getByTestId("extend-pay-add").click();
    await page.getByTestId("extend-pay-amount-2").fill("3");
    await page.getByTestId("extend-pay-currency-2").selectOption("USD");
    await page.getByTestId("extend-pay-rate-2").fill("50");
    await page.getByTestId("extend-go").click();
    await expect(toast(page)).toContainText("تم تمديد الحجز");
    await expect(toast(page)).toContainText("اتحصّل");
    const row = (await env.q("select checkout::text, total_room::float, amount_paid::float from bookings where id = $1", [b]))[0];
    expect(row).toEqual({ checkout: cairoDate(1), total_room: 900, amount_paid: 900 });
    const rows = (await rec(env, "ahmed")).rows.filter((x) => x.bookingId === b && Number(x.collectionAmt) > 0);
    expect(rows.map((x) => `${x.collectionAmt} ${x.collectionCurrency} ${x.collectionMethod}`).sort()).toEqual(["100 EGP كاش", "3 USD كاش", "50 EGP فيزا"].sort());

    // الساعة 2:05: النزيل اللي خروجه النهارده خرج - الغرفة فضيت ومفيش تمديد
    const c = await env.seedBooking({ room: 612, guest: "Too Late", start: -1, nights: 1, price: 300, currency: "EGP" });
    await setCairoTime(page, 14, 5);
    await page.reload();
    await boardTile(page, 612).click();
    await expect(page.getByTestId("late-extend")).toHaveCount(0);
    await expect(page.getByTestId("extend-go")).toHaveCount(0);
    expect((await env.q("select checkout::text from bookings where id = $1", [c]))[0].checkout).toBe(cairoDate(0));
  });
});
