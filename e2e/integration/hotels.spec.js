// الفنادق المتعددة (Calma + Revento + Park Plaza + The Location): كل فندق بروفايل مستقل - غرفه، حجوزاته، يوميته، تحصيله، تقاريره.
// الموظفين مشتركين (بيختاروا فندق + شيفت كل يوم) والمدير العام بيشوف فندق فندق + تقرير مجمّع للجروب H&S.
import { test, expect } from "../fixtures";
import { login, goTab, toast, boardTile, roomCard, openRoom, payOnBoard, addBooking, claimShift, showAllRooms, waitLedgerSaved, cairoDate, myShiftKey, shiftDay, SHIFT_LABEL, digits } from "../ui";

async function users(env) {
  await env.seedUser("boss", "gm", "المدير");
  await env.seedUser("ahmed", "staff", "أحمد");
  await env.seedUser("sara", "staff", "سارة");
  await env.seedUser("rawan", "reservations", "روان");
  await env.seedUser("mona", "accounts", "منى");
}
const hotelSelect = (page) => page.getByLabel("الفندق", { exact: true });
const switchHotel = async (page, name) => { await hotelSelect(page).selectOption({ label: name }); await expect(hotelSelect(page).locator("option:checked")).toHaveText(name); await page.waitForTimeout(500); };
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
    await expect(hotelSelect(page).locator("option")).toHaveText(["فندق Calma", "Revento", "Park Plaza", "The Location"]);
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
    await expect(hotelSelect(page)).toHaveValue("4");
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
    await expect(hotelSelect(page)).toHaveValue("2");
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
    await expect(hotelSelect(page)).toHaveValue("2");
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
