// الوقت (الأوفر تايم، منتصف الليل، الشيفت الليلي) وأعطال الشبكة/السيرفر وسط العمليات.
import { test, expect } from "../fixtures";
import { login, logout, goTab, field, boardTile, roomCard, toast, digits, cairoDate, addBooking, setCairoTime, SHIFT_LABEL, refresh, openRoom } from "../ui";

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
  test("بعد نهاية الشيفت بساعة ونص: لسه شغّال ويقدر يعدّل ويحصّل، وبعد ساعتين بيتقفل تلقائي ويتقفل عليه كل حاجة", async ({ page, env }) => {
    await users(env);
    await env.seedBooking({ room: 601, guest: "Overtime Guest", nights: 1, price: 100 });
    await env.seedShift("ahmed", { key: "morning", day: today() });

    // ١٧:٣٠ (الصباحي بيخلص ١٦:٠٠ + ساعتين أوفر تايم)
    await setCairoTime(page, 17, 30);
    await page.goto("/");
    await login(page, "ahmed");
    await goTab(page, "اليومية");
    await page.locator("table.cx-table tbody tr", { hasText: "602" }).first().getByPlaceholder("المبلغ").nth(0).fill("15");
    await page.waitForTimeout(1300);
    expect(Number((await rec(env, "ahmed")).rows.find((r) => r.room === 602).expenseAmt)).toBe(15);
    await goTab(page, "لوحة الغرف");
    await openRoom(page, 601);
    await roomCard(page).getByRole("button", { name: /تسجيل تحصيل كامل المبلغ/ }).click();
    await expect(toast(page)).toContainText("تم تسجيل التحصيل الكامل");
    expect((await env.q("select closed from shift_records"))[0].closed).toBe(false);

    // ١٨:٣٠: الأوفر تايم خلص
    await setCairoTime(page, 18, 30);
    await page.reload();
    await goTab(page, "اليومية");
    await expect(page.getByText(/مقفول|أُقفل بواسطة/).first()).toBeVisible();
    const r = await rec(env, "ahmed");
    expect(r.closed).toBe(true);
    expect(r.closed_by).toContain("إقفال تلقائي - انتهى هامش الأوفر تايم");
    expect(r.closing_cash).toMatchObject({ EGP: -15, USD: 100 });
    await expect(page.locator("table.cx-table tbody tr").first().locator("input").first()).toBeDisabled();
    // مفيش حجز جديد ولا تحصيل بعد انتهاء الشيفت
    await goTab(page, "الحجوزات");
    await expect(page.getByRole("button", { name: /حجز جديد/ })).toHaveCount(0);
    const log = await env.q("select action from activity_log where action like '%إقفال تلقائي%'");
    expect(log.length).toBe(1);
  });

  test("الشيفت المسائي بعد منتصف الليل (٠٠:٣٠): لسه أوفر تايم على يوم الشيفت اللي قبل نص الليل، والتحصيل بيتسجّل عليه", async ({ page, env }) => {
    await users(env);
    await env.seedBooking({ room: 602, guest: "Midnight Guest", start: 0, nights: 1, price: 100 });
    await env.seedShift("ahmed", { key: "evening", day: yesterday() });
    await setCairoTime(page, 0, 30);
    await page.goto("/");
    await login(page, "ahmed");
    await goTab(page, "لوحة الغرف");
    await openRoom(page, 602);
    await roomCard(page).getByRole("button", { name: /تسجيل تحصيل كامل المبلغ/ }).click();
    await expect(toast(page)).toContainText("تم تسجيل التحصيل الكامل");
    const r = await rec(env, "ahmed");
    expect(r).toMatchObject({ date: yesterday(), shift_key: "evening", closed: false });
    expect(Number(r.rows.find((x) => x.room === 602).collectionAmt)).toBe(100);
    // ٠٢:٣٠: الأوفر تايم خلص
    await setCairoTime(page, 2, 30);
    await page.reload();
    await goTab(page, "لوحة الغرف");
    await openRoom(page, 603);
    await expect(page.getByText(/مش شيفتك دلوقتي/).first()).toBeVisible();
  });
});

test.describe("تبديل الشيفتات والشيفت الليلي", () => {
  test("الموظف المسائي يبدأ ١٧:٠٠: الصباحي (لسه مفتوح) بيتقفل تلقائي وعهدته بتتنقل", async ({ page, env }) => {
    await users(env);
    await env.seedShift("sara", { key: "morning", day: today(), collections: [{ room: 601, amount: 250, method: "كاش", currency: "EGP" }] });
    await setCairoTime(page, 17, 0);
    await page.goto("/");
    await login(page, "ahmed");
    await goTab(page, "اليومية");
    await expect(page.getByRole("button", { name: new RegExp(SHIFT_LABEL.morning) })).toBeDisabled();
    await page.getByRole("button", { name: new RegExp(SHIFT_LABEL.evening) }).click();
    await expect(page.getByText("شيفتك الوحيد المتاح ليك النهارده")).toBeVisible();
    const sara = await rec(env, "sara");
    expect(sara).toMatchObject({ closed: true });
    expect(sara.closed_by).toContain("إقفال تلقائي");
    expect((await rec(env, "ahmed")).handover).toEqual({ EGP: 250 });
  });

  test("الشيفت الليلي ٠٢:٠٠: بيتسجّل على يوم المسائي اللي قبله، والحجز والتحصيل بيروحوا ليومية الليلي، والتقرير بيعرضه", async ({ page, env }) => {
    await users(env);
    await setCairoTime(page, 2, 0);
    await page.goto("/");
    await login(page, "ahmed");
    await goTab(page, "اليومية");
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
  test("تحصيل اتحفظ على الحجز لكن تسجيله في اليومية فشل: الموظف بيتنبّه يسجّله يدوي (مفيش فلوس بتتخبّى)", async ({ page, env }) => {
    await users(env);
    const id = await env.seedBooking({ room: 601, guest: "Partial Failure", nights: 1, price: 100 });
    await env.seedShift("ahmed");
    await page.goto("/");
    await login(page, "ahmed");
    await goTab(page, "لوحة الغرف");
    await openRoom(page, 601);
    await page.route(/fake-supabase\.test\/rest\/v1\/shift_records/, async (route) => {
      if (route.request().method() === "PATCH") return route.fulfill({ status: 500, headers: { "access-control-allow-origin": "*", "content-type": "application/json" }, body: JSON.stringify({ message: "boom", code: "XX000" }) });
      return route.fallback();
    });
    await roomCard(page).getByRole("button", { name: /تسجيل تحصيل كامل المبلغ/ }).click();
    await expect(toast(page)).toContainText("تعذر تسجيله تلقائيًا في اليومية");
    const [b] = await env.q("select amount_paid, settled from bookings where id = $1", [id]);
    expect(b).toEqual({ amount_paid: 100, settled: true });
    expect((await rec(env, "ahmed")).booking_collections).toHaveLength(0);
  });

  test("فشل حفظ حجز جديد (٥٠٠): الفورم يفضل مفتوح بالبيانات ورسالة الخطأ ظاهرة ومفيش حجز نص-نص", async ({ page, env }) => {
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
