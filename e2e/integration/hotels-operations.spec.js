// الفنادق الجديدة من الواجهة بالتفصيل: تحصيل كافيتيريا النزيل، كافيتيريا الاستاف، إقفال الشيفت، عهدة كل فندق لوحدها،
// بحث Ctrl+K بين الفنادق، وإدارة الفنادق والغرف وفنادق الموظف من شاشة المدير العام.
import { test, expect } from "../fixtures";
import { login, goTab, toast, roomCard, openRoom, payOnBoard, claimShift, showAllRooms, waitIdle, digits, shiftDay, myShiftKey } from "../ui";

async function users(env) {
  await env.seedUser("boss", "gm", "المدير");
  await env.seedUser("ahmed", "staff", "أحمد");
  await env.seedUser("sara", "staff", "سارة");
  await env.seedUser("rawan", "reservations", "روان");
}
const HOTELS = [[2, "Revento", 207, 201], [3, "Park Plaza", 410, 401], [4, "The Location", 304, 301]];
const ORDER = ["morning", "evening", "night"];
const prevOf = (day, key) => { const i = ORDER.indexOf(key); if (i > 0) return { day, key: ORDER[i - 1] }; const d = new Date(day + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() - 1); return { day: d.toISOString().slice(0, 10), key: "night" }; };
const tab = (page, name) => page.getByRole("tab", { name, exact: true });
const pick = async (page, name) => { await tab(page, name).click(); await expect(tab(page, name)).toHaveAttribute("aria-selected", "true"); await page.waitForTimeout(500); };

for (const [hid, hname, room, firstRoom] of HOTELS) {
  test.describe(`${hname}: التشغيل الكامل من الواجهة`, () => {
    test("كافيتيريا النزيل + كافيتيريا الاستاف + إقفال الشيفت، وكله في يومية الفندق ده بس", async ({ page, env }) => {
      await users(env);
      const id = await env.seedBooking({ room, guest: "Cafe Guest", nights: 1, price: 100, total: 100, extras: { laundry: 0, cafeteria: 40, tours: 0, pickup: 0 } });
      await env.seedShift("ahmed", { hotel: hid });
      await env.seedShift("sara", { hotel: 1, key: myShiftKey() === "morning" ? "evening" : "morning" });
      await page.goto("/");
      await login(page, "ahmed");
      await expect(tab(page, hname)).toHaveAttribute("aria-selected", "true");        // فندقه بيتفتح لوحده
      // اليومية فيها غرف الفندق ده بس
      await goTab(page, "اليومية"); await showAllRooms(page);
      await expect(page.locator("table.cx-table tbody tr", { hasText: String(firstRoom) }).first()).toBeVisible();
      await expect(page.locator("table.cx-table tbody tr", { hasText: "601" })).toHaveCount(0);
      await expect(page.getByTestId("cafeteria-guest-due")).toContainText("Cafe Guest");
      // تحصيل دفعة على النزيل: بتسدّد الكافيتيريا الأول وبتتسجّل في يومية الفندق
      await goTab(page, "لوحة الغرف"); await openRoom(page, room);
      await payOnBoard(page, { amount: 60, method: "كاش" });
      await expect(toast(page)).toContainText("كافيتيريا");
      const rec = (await env.q("select * from shift_records where hotel_id = $1 and staff_username = 'ahmed'", [hid]))[0];
      expect(rec.cafeteria_rows).toHaveLength(1);
      expect(Number(rec.cafeteria_rows[0].collectionAmt)).toBe(40);
      expect(Number((await env.q("select amount_paid a from bookings where id = $1", [id]))[0].a)).toBe(60);
      const other = (await env.q("select cafeteria_rows, rows from shift_records where hotel_id = 1"))[0];
      expect(other.cafeteria_rows).toHaveLength(0);
      expect(other.rows.every((r) => !Number(r.collectionAmt))).toBe(true);
      // كافيتيريا الاستاف (آجل) بتتسجّل على الفندق ده
      await goTab(page, "اليومية");
      await page.getByTestId("staff-cafe-who").selectOption("sara");
      await page.getByTestId("staff-cafe-amount").fill("25");
      await page.getByTestId("staff-cafe-add").click(); await waitIdle(page);
      await expect(toast(page)).toContainText("تم تسجيل الاستهلاك");
      const debts = await env.q("select hotel_id, amount::numeric a from staff_cafeteria");
      expect(debts.map((d) => [d.hotel_id, Number(d.a)])).toEqual([[hid, 25]]);
      // إقفال الشيفت من الواجهة
      await page.getByRole("button", { name: /إقفال الشيفت/ }).click();
      await expect(page.getByText(/أُقفل بواسطة/)).toBeVisible();
      const closed = (await env.q("select hotel_id, closed from shift_records order by hotel_id")).map((r) => [r.hotel_id, r.closed]);
      expect(closed.find((c) => c[0] === hid)[1]).toBe(true);
      expect(closed.find((c) => c[0] === 1)[1]).toBe(false);             // يومية Calma لسه مفتوحة
    });
  });
}

test.describe("العهدة لكل فندق لوحدها", () => {
  test("الشيفت الجديد في كل فندق بياخد عهدة الشيفت اللي قبله في نفس الفندق بس", async ({ page, env }) => {
    await users(env);
    const p = prevOf(shiftDay(), myShiftKey());
    await env.seedShift("sara", { hotel: 3, day: p.day, key: p.key, closed: true, closingCash: { EGP: 500 } });
    await env.seedShift("rawan", { hotel: 2, day: p.day, key: p.key, closed: true, closingCash: { EGP: 900 } });
    await page.goto("/");
    await login(page, "ahmed");
    await pick(page, "Park Plaza");
    await claimShift(page);
    const rec = (await env.q("select hotel_id, handover from shift_records where staff_username = 'ahmed'"))[0];
    expect(rec.hotel_id).toBe(3);
    expect(rec.handover).toEqual({ EGP: 500 });                        // مش ٩٠٠ بتاعة Revento
  });
});

test.describe("بحث Ctrl+K بين الفنادق", () => {
  test("نزيل في فندق تاني بيظهر في البحث، والضغط عليه بيفتح فندقه وغرفته", async ({ page, env }) => {
    await users(env);
    await env.seedBooking({ room: 218, guest: "Zed Revento", start: 0, nights: 2 });
    await page.goto("/");
    await login(page, "boss");
    await expect(tab(page, "فندق Calma")).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Control+k");
    await page.getByRole("combobox", { name: "بحث سريع" }).fill("Zed");
    const item = page.getByRole("option").filter({ hasText: "Zed Revento" });
    await expect(item).toContainText("Revento");                       // اسم الفندق ظاهر
    await item.click();
    await expect(tab(page, "Revento")).toHaveAttribute("aria-selected", "true");
    await expect(roomCard(page)).toContainText("Zed Revento");
  });
});

test.describe("إدارة الفنادق والغرف (المدير العام)", () => {
  test("إضافة فندق جديد وغرف له، تعديل اسم غرفة، وبادئة كود الحجز", async ({ page, env }) => {
    await users(env);
    await page.goto("/");
    await login(page, "boss");
    await goTab(page, "إدارة المستخدمين");
    const admin = page.getByTestId("hotels-admin");
    await expect(admin).toBeVisible();
    await admin.getByTestId("new-hotel-open").click();
    await admin.getByTestId("new-hotel-name").fill("Sea View");
    await admin.getByTestId("new-hotel-prefix").fill("S");
    await admin.getByTestId("new-hotel-save").click();
    await expect(toast(page)).toContainText("تم إضافة الفندق");
    await expect(tab(page, "Sea View")).toBeVisible();
    // إضافة غرفة للفندق الجديد
    await admin.getByTestId("new-room-number").fill("501");
    await admin.getByTestId("new-room-name").fill("Suite 501");
    await admin.getByTestId("new-room-save").click();
    await expect(toast(page)).toContainText("تم إضافة الغرفة");
    expect((await env.q("select hotel_id, name from rooms where number = 501"))[0]).toEqual({ hotel_id: 5, name: "Suite 501" });
    // رقم مكرر (حتى في فندق تاني) مرفوض
    await admin.getByTestId("new-room-number").fill("205");
    await admin.getByTestId("new-room-save").click();
    await expect(toast(page)).toContainText("مستخدم");
    // تعديل اسم غرفة
    await admin.getByLabel("اسم غرفة 501", { exact: true }).fill("Suite VIP");
    await admin.getByLabel("تثبيت اسم غرفة 501").click();
    await expect(toast(page)).toContainText("تم تغيير اسم الغرفة");
    expect((await env.q("select name from rooms where number = 501"))[0].name).toBe("Suite VIP");
    // الفندق الجديد بيظهر في الشريط بغرفه، وحجز فيه بياخد كوده
    await pick(page, "Sea View");
    await goTab(page, "لوحة الغرف");
    await expect(page.locator(".cx-tile")).toHaveCount(1);
    await env.seedBooking({ room: 501, guest: "Sea Guest", nights: 1 });
    expect((await env.q("select code from bookings where guest_name = 'Sea Guest'"))[0].code).toMatch(/^S\d{4}-0001$/);
    // تعديل اسم فندق
    await goTab(page, "إدارة المستخدمين");
    await page.getByLabel("اسم الفندق 2", { exact: true }).fill("Revento Resort");
    await page.getByTestId("hotel-admin-2").getByRole("button", { name: "تثبيت" }).click();
    await expect(toast(page)).toContainText("تم حفظ بيانات الفندق");
    await expect(tab(page, "Revento Resort")).toBeVisible();
  });

  test("تحديد فنادق الموظف: الموظف بيشوف فنادقه بس والقاعدة بترفض غيرها", async ({ page, env }) => {
    await users(env);
    await page.goto("/");
    await login(page, "boss");
    await goTab(page, "إدارة المستخدمين");
    const row = page.getByTestId("user-hotels-ahmed");
    for (const n of ["فندق Calma", "Revento", "The Location"]) { await row.getByLabel(`ahmed - ${n}`).click(); await expect(row.getByLabel(`ahmed - ${n}`)).not.toBeChecked(); await page.waitForTimeout(500); }
    expect((await env.q("select allowed_hotels from profiles where username = 'ahmed'"))[0].allowed_hotels).toEqual([3]);
    const p2 = await env.newSession();
    await p2.goto("/");
    await login(p2, "ahmed");
    await expect(p2.getByRole("tablist").getByRole("tab")).toHaveCount(0);          // فندق واحد = مفيش شريط تبديل
    await expect(p2.getByTestId("hotel-tag")).toHaveCount(0);
    expect((await env.q("select count(*)::int n from rooms where hotel_id = 3"))[0].n).toBe(33);
    const bad = await env.api("ahmed", "POST", "/rest/v1/shift_claims", { hotel_id: 1, date: shiftDay(), shift_key: myShiftKey(), username: "ahmed", name: "x" });
    expect(bad.status).toBeGreaterThanOrEqual(400);
  });
});
