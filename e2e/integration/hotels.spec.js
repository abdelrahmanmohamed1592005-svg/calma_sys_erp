// الفنادق المتعددة (Calma + Revento + Park Plaza + The Location): كل فندق بروفايل مستقل - غرفه، حجوزاته، يوميته، تحصيله، تقاريره.
// الموظفين مشتركين (بيختاروا فندق + شيفت كل يوم) والمدير العام بيشوف فندق فندق + تقرير مجمّع للجروب H&S.
import { test, expect } from "../fixtures";
import { field, login, goTab, toast, boardTile, roomCard, openRoom, payOnBoard, addBooking, claimShift, showAllRooms, waitLedgerSaved, cairoDate, myShiftKey, shiftDay, SHIFT_LABEL, digits } from "../ui";

async function users(env) {
  await env.seedUser("boss", "gm", "المدير");
  await env.seedUser("ahmed", "staff", "أحمد");
  await env.seedUser("sara", "staff", "سارة");
  await env.seedUser("rawan", "reservations", "روان");
  await env.seedUser("mona", "accounts", "منى");
}
const hotelTab = (page, name) => page.getByRole("tab", { name, exact: true });
const hotelTabs = (page) => page.getByRole("tablist").getByRole("tab");
const activeHotelId = async (page) => page.locator('[role="tab"][aria-selected="true"]').getAttribute("data-hotel-id");
const switchHotel = async (page, name) => { await hotelTab(page, name).click(); await expect(hotelTab(page, name)).toHaveAttribute("aria-selected", "true"); await expect(page.getByTestId("hotel-tag")).toHaveText(name); await page.waitForTimeout(500); };
const tiles = (page) => page.locator(".cx-tile");

test.describe("بروفايل مستقل لكل فندق", () => {
  test("القاعدة فيها ٤ فنادق بغرفها: Calma 16، Revento 25 من 201، Park Plaza 33 من 401، The Location 7 من 301", async ({ env }) => {
    const rows = await env.q("select h.name, count(r.*)::int n, min(r.number) lo, max(r.number) hi from hotels h join rooms r on r.hotel_id = h.id group by h.id, h.name order by h.id");
    expect(rows.map((r) => [r.name, r.n, r.lo, r.hi])).toEqual([["فندق Calma", 16, 601, 616], ["Revento", 25, 201, 225], ["Park Plaza", 33, 401, 433], ["The Location", 7, 301, 307]]);
  });

  test("المدير العام: مبدّل الفنادق بيعرض غرف كل فندق لوحده بالعدد والأرقام الصح", async ({ page, env }) => {
    await users(env);
    await page.goto("/");
    await login(page, "boss");
    await expect(hotelTabs(page)).toHaveCount(4);
    await expect(hotelTabs(page)).toContainText(["فندق Calma", "Revento", "Park Plaza", "The Location"]);
    await expect(hotelTabs(page).first()).toContainText("16 غرفة");
    await expect(tiles(page)).toHaveCount(16);
    for (const [name, n, first, last] of [["Revento", 25, 201, 225], ["Park Plaza", 33, 401, 433], ["The Location", 7, 301, 307], ["فندق Calma", 16, 601, 616]]) {
      await switchHotel(page, name);
      await expect(tiles(page)).toHaveCount(n);
      await expect(boardTile(page, first).first()).toBeVisible();
      await expect(boardTile(page, last).first()).toBeVisible();
    }
  });

  test("حجز في Revento مايظهرش في Calma ولا في Park Plaza، وبيتسجّل في القاعدة على فندق Revento", async ({ page, env }) => {
    await users(env);
    await env.seedBooking({ room: 205, guest: "Revento Guest", start: 0, nights: 2 });
    await env.seedBooking({ room: 610, guest: "Calma Guest", start: 0, nights: 2 });
    await env.seedBooking({ room: 410, guest: "Plaza Guest", start: 0, nights: 2 });
    expect((await env.q("select hotel_id from bookings where guest_name = 'Revento Guest'"))[0].hotel_id).toBe(2);
    expect((await env.q("select hotel_id from bookings where guest_name = 'Calma Guest'"))[0].hotel_id).toBe(1);
    expect((await env.q("select hotel_id from bookings where guest_name = 'Plaza Guest'"))[0].hotel_id).toBe(3);
    await page.goto("/");
    await login(page, "boss");
    await goTab(page, "الحجوزات");
    await expect(page.getByText("Calma Guest").first()).toBeVisible();
    await expect(page.getByText("Revento Guest")).toHaveCount(0);
    await expect(page.getByText("Plaza Guest")).toHaveCount(0);
    await switchHotel(page, "Revento");
    await expect(page.getByText("Revento Guest").first()).toBeVisible();
    await expect(page.getByText("Calma Guest")).toHaveCount(0);
    await switchHotel(page, "Park Plaza");
    await expect(page.getByText("Plaza Guest").first()).toBeVisible();
    await expect(page.getByText("Revento Guest")).toHaveCount(0);
  });

  test("اختيار الفندق بيفضل بعد تحديث الصفحة", async ({ page, env }) => {
    await users(env);
    await page.goto("/");
    await login(page, "boss");
    await switchHotel(page, "The Location");
    await expect(tiles(page)).toHaveCount(7);
    await page.reload();
    await expect(tiles(page)).toHaveCount(7);
    expect(await activeHotelId(page)).toBe("4");
  });

  test("مدير الحجوزات والحسابات كمان بيبدّلوا بين الفنادق", async ({ page, env }) => {
    await users(env);
    await page.goto("/");
    await login(page, "rawan");
    await switchHotel(page, "Revento");
    await expect(tiles(page)).toHaveCount(25);
  });
});

test.describe("الموظفين مشتركين: اختيار فندق + شيفت كل يوم", () => {
  test("الموظف بيفتح فندق Revento ويحجز الشيفت: اليومية فيها غرف Revento بس، واتسجّلت على فندق 2", async ({ page, env }) => {
    await users(env);
    await page.goto("/");
    await login(page, "ahmed");
    await switchHotel(page, "Revento");
    await claimShift(page);
    await showAllRooms(page);
    const rec = (await env.q("select hotel_id, jsonb_array_length(rows)::int n, (select min((x->>'room')::int) from jsonb_array_elements(rows) x) lo from shift_records where staff_username = 'ahmed'"))[0];
    expect(rec.hotel_id).toBe(2);
    expect(rec.n).toBe(25);
    expect(rec.lo).toBe(201);
    const claim = (await env.q("select hotel_id from shift_claims where username = 'ahmed'"))[0];
    expect(claim.hotel_id).toBe(2);
  });

  test("نفس الشيفت في نفس اليوم ممكن يتحجز في فنادق مختلفة بموظفين مختلفين", async ({ page, env }) => {
    await users(env);
    await env.seedShift("sara", { hotel: 1 });
    await page.goto("/");
    await login(page, "ahmed");
    await switchHotel(page, "Park Plaza");
    await claimShift(page);
    const r = await env.q("select hotel_id, staff_username from shift_records where date = $1 order by hotel_id", [shiftDay()]);
    expect(r.map((x) => [x.hotel_id, x.staff_username])).toEqual([[1, "sara"], [3, "ahmed"]]);
  });

  test("موظف اختار شيفت في فندق ومايقدرش يختار شيفت تاني في فندق تاني في نفس اليوم", async ({ page, env }) => {
    await users(env);
    await env.seedShift("ahmed", { hotel: 2 });
    await page.goto("/");
    await login(page, "ahmed");
    // الموظف بيتفتحله فندقه المحجوز تلقائيًا
    await expect.poll(() => activeHotelId(page)).toBe("2");
    await switchHotel(page, "فندق Calma");
    await goTab(page, "اليومية");
    await page.getByRole("button", { name: new RegExp(SHIFT_LABEL[myShiftKey()]) }).click();
    await expect(toast(page)).toContainText(/اخترت شيفتك النهارده بالفعل/);
    expect((await env.q("select count(*)::int n from shift_claims where username = 'ahmed'"))[0].n).toBe(1);
  });

  test("تحصيل على حجز Revento من لوحة الغرف بيتسجّل في يومية Revento بس ومايلمسش يومية Calma", async ({ page, env }) => {
    await users(env);
    await env.seedBooking({ room: 207, guest: "Rev Pay", start: -1, nights: 3, price: 100, total: 300 });
    await env.seedBooking({ room: 603, guest: "Calma Pay", start: -1, nights: 3, price: 100, total: 300 });
    await env.seedShift("ahmed", { hotel: 2 });
    await env.seedShift("sara", { hotel: 1, key: myShiftKey() === "morning" ? "evening" : "morning" });
    await page.goto("/");
    await login(page, "ahmed");
    await expect.poll(() => activeHotelId(page)).toBe("2");
    await openRoom(page, 207);
    await payOnBoard(page, { amount: 120 });
    await expect(toast(page)).toBeVisible();
    const b = (await env.q("select amount_paid::numeric a from bookings where guest_name = 'Rev Pay'"))[0];
    expect(Number(b.a)).toBe(120);
    const recs = await env.q("select hotel_id, (select coalesce(sum(nullif(x->>'collectionAmt','')::numeric),0) from jsonb_array_elements(rows) x) s from shift_records order by hotel_id");
    expect(recs.map((r) => [r.hotel_id, Number(r.s)])).toEqual([[1, 0], [2, 120]]);
  });

  test("التحصيل على حجز فندق تاني من قاعدة البيانات مرفوض حتى لو الواجهة اتلاعب فيها (API مباشر)", async ({ env }) => {
    await users(env);
    const calma = await env.seedBooking({ room: 604, guest: "Calma Direct", start: -1, nights: 2, price: 100, total: 200 });
    await env.seedShift("ahmed", { hotel: 2 });
    const res = await env.api("ahmed", "POST", "/rest/v1/rpc/record_booking_payment", { p_booking: calma, p_amount: 50, p_method: "كاش" });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(res.body)).toContain("فندق تاني");
    expect(Number((await env.q("select amount_paid a from bookings where id = $1", [calma]))[0].a)).toBe(0);
  });

  test("نقل حجز لغرفة في فندق تاني مرفوض من القاعدة", async ({ env }) => {
    await users(env);
    const id = await env.seedBooking({ room: 208, guest: "Mover", start: 0, nights: 3 });
    const res = await env.api("rawan", "PATCH", `/rest/v1/bookings?id=eq.${id}`, { room: 603 });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect((await env.q("select room, hotel_id from bookings where id = $1", [id]))[0]).toMatchObject({ room: 208, hotel_id: 2 });
  });
});

test.describe("نقل النزيل وإضافة الحجز", () => {
  test("موظف الشيفت (في فندق شيفته) ومدير الحجوزات عندهم زرار نقل نزيل", async ({ page, env }) => {
    await users(env);
    await env.seedBooking({ room: 603, guest: "Mv Guest", start: -1, nights: 3, price: 100 });
    await env.seedShift("ahmed", { hotel: 1 });
    await page.goto("/");
    await login(page, "ahmed");
    await goTab(page, "لوحة الغرف");
    await openRoom(page, 603);
    await expect(roomCard(page)).toContainText("Mv Guest");
    await expect(roomCard(page).getByTestId("move-open")).toBeVisible();
    const p2 = await env.newSession();
    await p2.goto("/");
    await login(p2, "rawan");
    await goTab(p2, "لوحة الغرف");
    await openRoom(p2, 603);
    await expect(roomCard(p2).getByTestId("move-open")).toBeVisible();
  });

  test("موظف الشيفت ينقل النزيل ويعدّل سعر الحجز من الحجوزات", async ({ page, env }) => {
    await users(env);
    await env.seedBooking({ room: 603, guest: "Pr Guest", start: 1, nights: 2, price: 100, total: 200 });
    await env.seedShift("ahmed", { hotel: 1 });
    await page.goto("/");
    await login(page, "ahmed");
    await goTab(page, "الحجوزات");
    await page.getByTestId("edit-price").first().click();
    const price = page.locator('input[type="number"]:not([disabled])').first();
    await expect(price).toBeVisible();
    const bk = (await env.q("select id from bookings where guest_name = 'Pr Guest'"))[0].id;
    const direct = await env.api("ahmed", "PATCH", "/rest/v1/bookings?id=eq." + bk, { price_night: 150, total_room: 300 });
    expect(direct.status).toBeLessThan(300);
    expect((await env.q("select price_night::int p from bookings where id = '" + bk + "'"))[0].p).toBe(150);
    const mv = await env.api("ahmed", "POST", "/rest/v1/rpc/move_booking_room", { p_booking: bk, p_room: 604 });
    expect(mv.status).toBeLessThan(300);
  });

  test("حجز جديد بدفعة مقسّمة: ٦٠ دولار كاش + ١٥٠٠ جنيه بسعر صرف ٥٠ = ٩٠ دولار، وكل دفعة بتتسجّل في اليومية بعملتها", async ({ page, env }) => {
    await users(env);
    await env.seedShift("ahmed", { hotel: 1 });
    await page.goto("/");
    await login(page, "ahmed");
    await goTab(page, "الحجوزات");
    await page.getByRole("button", { name: /حجز جديد/ }).click();
    const form = page.locator(".cx-card[data-calma-editing]");
    await form.locator("select.cx-select").first().selectOption("603");
    await field(page, "اسم النزيل").fill("Split Pay");
    await field(page, "تاريخ الدخول").fill(cairoDate(0));
    await field(page, "تاريخ الخروج").fill(cairoDate(1));
    await page.locator("xpath=//label[contains(.,'السعر لليلة')]/following-sibling::div//input[@type='number']").fill("100");
    await page.locator("xpath=//label[contains(.,'السعر لليلة')]/following-sibling::div//select").selectOption("USD");
    await page.getByTestId("advance-amount").fill("60");
    await page.getByTestId("advance-add-line").click();
    await page.getByTestId("advance-extra-amount-0").fill("1500");
    await page.getByTestId("advance-extra-currency-0").selectOption("EGP");
    await page.getByTestId("advance-extra-rate-0").fill("50");
    await page.locator(".cx-card[data-calma-editing]").getByRole("button", { name: /حفظ الحجز/ }).click();
    await expect(toast(page)).toContainText("تم الحفظ");
    const b = (await env.q("select amount_paid::float p from bookings where guest_name = 'Split Pay'"))[0];
    expect(b.p).toBe(90);
    const rows = await env.q("select r->>'collectionCurrency' cur, calma_num(r->>'collectionAmt')::float amt from shift_records s, jsonb_array_elements(s.rows) r where s.staff_username = 'ahmed' and calma_num(r->>'collectionAmt') > 0 order by 1");
    expect(rows.map((r) => [r.cur, r.amt])).toEqual([["EGP", 1500], ["USD", 60]]);
  });

  test("شيفت مشترك: صاحب الشيفت يضيف زميل، والزميل يحصّل على نفس اليومية", async ({ page, env }) => {
    await users(env);
    await env.seedBooking({ room: 603, guest: "Team Guest", start: -1, nights: 3, price: 100, total: 300 });
    await env.seedShift("ahmed", { hotel: 1 });
    await page.goto("/");
    await login(page, "ahmed");
    await goTab(page, "اليومية");
    await page.getByTestId("add-helper").selectOption("sara");
    
    await expect(page.getByTestId("shift-team").locator(".cx-pill")).toContainText("سارة");
    const p2 = await env.newSession();
    await p2.goto("/");
    await login(p2, "sara");
    await goTab(p2, "لوحة الغرف");
    await openRoom(p2, 603);
    await payOnBoard(p2, { amount: 50 });
   
    const rows = await env.q("select count(*)::int n from shift_records s, jsonb_array_elements(s.rows) r where s.staff_username = 'ahmed' and calma_num(r->>'collectionAmt') = 50");
    expect(rows[0].n).toBe(1);
    expect((await env.q("select helpers from shift_records where staff_username = 'ahmed'"))[0].helpers).toEqual(["sara"]);
  });

  test("موظف شيفته في Calma مايقدرش يضيف حجز في Revento حتى بطلب مباشر على الـ API", async ({ env }) => {
    await users(env);
    await env.seedShift("ahmed", { hotel: 1 });
    const body = (room) => ({ room, guest_name: "Wrong Hotel", checkin: cairoDate(5), checkout: cairoDate(6), price_night: 100, total_room: 100, currency: "USD" });
    const bad = await env.api("ahmed", "POST", "/rest/v1/bookings", body(210));
    expect(bad.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(bad.body)).toContain("فندق مش فندق شيفتك");
    const good = await env.api("ahmed", "POST", "/rest/v1/bookings", { ...body(606), guest_name: "Right Hotel" });
    expect(good.status).toBeLessThan(300);
    expect((await env.q("select count(*)::int n from bookings where guest_name = 'Wrong Hotel'"))[0].n).toBe(0);
    const byManager = await env.api("rawan", "POST", "/rest/v1/bookings", { ...body(210), guest_name: "Manager Booking" });
    expect(byManager.status).toBeLessThan(300);
  });
});

test.describe("تقارير كل فندق ومجمّع H&S للمدير العام", () => {
  async function seedRevenue(env) {
    await users(env);
    const a = await env.seedBooking({ room: 604, guest: "C1", start: -1, nights: 1, price: 100, total: 100, paid: 100, currency: "EGP" });
    const b = await env.seedBooking({ room: 210, guest: "R1", start: -1, nights: 1, price: 250, total: 250, paid: 250, currency: "EGP" });
    await env.seedShift("sara", { hotel: 1, key: "morning", day: shiftDay(), collections: [{ room: 604, amount: 100, currency: "EGP", bookingId: a }], stored: { total_collections: { EGP: 100 }, total_expenses: {} } });
    await env.seedShift("ahmed", { hotel: 2, key: "evening", day: shiftDay(), collections: [{ room: 210, amount: 250, currency: "EGP", bookingId: b }], stored: { total_collections: { EGP: 250 }, total_expenses: {} } });
  }

  test("تقرير الفندق المفتوح بيجمع تحصيل الفندق ده بس", async ({ page, env }) => {
    await seedRevenue(env);
    await page.goto("/");
    await login(page, "boss");
    await goTab(page, "التقارير");
    await expect(page.getByTestId("report-per-hotel")).toHaveCount(0);
    const txt = digits(await page.locator(".cx-report-grid").first().innerText());
    expect(txt).toContain("100");
    expect(txt).not.toContain("350");
    await switchHotel(page, "Revento");
    await expect.poll(async () => digits(await page.locator(".cx-report-grid").first().innerText())).toContain("250");
  });

  test("المدير العام: التقرير المجمّع H&S بيجمع الفندقين وبيعرض ملخص كل فندق", async ({ page, env }) => {
    await seedRevenue(env);
    await page.goto("/");
    await login(page, "boss");
    await goTab(page, "التقارير");
    await page.getByTestId("report-scope-all").click();
    const per = page.getByTestId("report-per-hotel");
    await expect(per).toBeVisible();
    const t = digits(await per.innerText());
    expect(t).toContain("Revento");
    expect(t).toContain("250");
    expect(t).toContain("100");
    await expect.poll(async () => digits(await page.locator(".cx-report-grid").first().innerText())).toContain("350");
  });

  test("غير المدير العام ما يشوفش زرار التقرير المجمّع", async ({ page, env }) => {
    await seedRevenue(env);
    await page.goto("/");
    await login(page, "mona");
    await goTab(page, "التقارير");
    await expect(page.getByTestId("report-scope-all")).toHaveCount(0);
    await page.goto("/");
  });
});

test.describe("الجهاز المشترك: الموظف مايختارش شيفته في فندق غلط بالغلط", () => {
  test("موظف من غير شيفت بيفتح على أول فندق مش على اللي المدير اختاره قبله على نفس الجهاز، واللافتة بتوضّح الفندق قبل الاختيار", async ({ page, env }) => {
    await users(env);
    await page.goto("/");
    await login(page, "boss");
    await switchHotel(page, "Park Plaza");                       // المدير سايب الجهاز على Park Plaza
    await page.getByTitle("تسجيل خروج").click();
    const gate = page.getByRole("button", { name: /طباعة التقرير وتسجيل الخروج/ });
    if (await gate.isVisible().catch(() => false)) { await page.evaluate(() => { window.print = () => {}; }); await gate.click(); }
    await expect(page.getByRole("button", { name: "دخول", exact: true })).toBeVisible();     // الخروج خلص وشاشة الدخول ظهرت (قبل كده كان بيكتب الاسم بدري ساعات)
    await login(page, "ahmed");                                   // موظف بيدخل على نفس الجهاز
    await expect.poll(() => activeHotelId(page)).toBe("1");        // فندق ١ مش Park Plaza
    await goTab(page, "اليومية");
    const banner = page.getByTestId("claim-hotel-banner");
    await expect(banner).toContainText("فندق Calma");
    await switchHotel(page, "Revento");
    await expect(banner).toContainText("Revento");                // اللافتة بتتبع الفندق المفتوح
    expect((await env.q("select count(*)::int n from shift_claims"))[0].n).toBe(0);   // لسه ماختارش حاجة
  });
});
