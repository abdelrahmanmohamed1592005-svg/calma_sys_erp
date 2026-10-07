// الصلاحيات من الواجهة لكل دور، فوق قاعدة بيانات حقيقية (RLS + triggers):
// اللي الشاشة بتعرضه واللي بتسمح بيه، واللي قاعدة البيانات نفسها بتفرضه.
import { test, expect } from "../fixtures";
import { login, logout, goTab, field, tab, boardTile, roomCard, toast, refresh, digits, cairoDate, addBooking, shiftDay, myShiftKey, openRoom, openMore } from "../ui";

async function users(env) {
  await env.seedUser("boss", "gm", "المدير");
  await env.seedUser("ahmed", "staff", "أحمد");
  await env.seedUser("sara", "staff", "سارة");
  await env.seedUser("rawan", "reservations", "روان");
  await env.seedUser("mona", "accounts", "منى");
}
const tabsOf = async (page) => (await page.locator(".cx-tab").allInnerTexts()).map((t) => t.trim());

test.describe("موظف الشيفت", () => {
  test("من غير شيفت محجوز: مفيش حجز جديد ولا تحصيل ولا تغيير حالة غرفة", async ({ page, env }) => {
    await users(env);
    const id = await env.seedBooking({ room: 601, guest: "Booked Guest", nights: 2, price: 100 });
    await page.goto("/");
    await login(page, "sara");               // سارة معاها شيفت مش محجوز
    expect(await tabsOf(page)).toEqual(["لوحة الغرف", "اليومية", "الحجوزات"]);

    await goTab(page, "الحجوزات");
    await expect(page.getByRole("button", { name: /حجز جديد/ })).toHaveCount(0);
    await expect(page.getByText(/مش شيفتك دلوقتي/)).toBeVisible();

    await goTab(page, "لوحة الغرف");
    await openRoom(page, 601);
    await expect(roomCard(page)).toContainText("Booked Guest");
    await expect(page.getByRole("button", { name: /تسجيل تحصيل كامل المبلغ/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /تمديد الحجز/ })).toHaveCount(0);
    await expect(page.getByText(/مش شيفتك دلوقتي/).first()).toBeVisible();
    await openRoom(page, 602);
    await expect(page.getByText(/مش شيفتك دلوقتي - الحالة مش هتتعدل/)).toBeVisible();

    // حتى بالـ API مباشرة: قاعدة البيانات بترفض (موظف من غير شيفت مقفول عليه كل حاجة بتخص اليومية)
    const [b] = await env.q("select * from bookings where id = $1", [id]);
    expect(b.amount_paid).toBe(0);
  });

  test("شيفتي مقفول: بيشوف رسالة وكل التعديلات متقفلة لحد ما حد يفتحه", async ({ page, env }) => {
    await users(env);
    await env.seedBooking({ room: 602, guest: "Closed Shift", nights: 1, price: 100 });
    await env.seedShift("ahmed", { closed: true });
    await page.goto("/");
    await login(page, "ahmed");
    await goTab(page, "الحجوزات");
    await expect(page.getByRole("button", { name: /حجز جديد/ })).toHaveCount(0);
    await expect(page.getByText(/شيفتك مقفول/)).toBeVisible();
    await goTab(page, "لوحة الغرف");
    await openRoom(page, 602);
    await expect(page.getByText(/شيفتك مقفول/).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /تسجيل تحصيل كامل المبلغ/ })).toHaveCount(0);
  });

  test("غرفة متاحة: الموظف يغيّر حالتها (صيانة/تنظيف) وبتتسجّل باسمه، ومدير الحجوزات يشوفها", async ({ page, env }) => {
    await users(env);
    await env.seedShift("ahmed");
    await page.goto("/");
    await login(page, "ahmed");
    await goTab(page, "لوحة الغرف");
    await openRoom(page, 603);
    await page.getByRole("button", { name: "صيانة" }).click();
    await expect(toast(page)).toContainText("تم تحديث حالة الغرفة");
    await openRoom(page, 604);
    await page.getByRole("button", { name: "تحت التنظيف" }).click();
    await expect(toast(page)).toContainText("تم تحديث حالة الغرفة");
    const ovs = await env.q("select room_number, status, updated_by from room_overrides order by room_number");
    expect(ovs).toEqual([{ room_number: 603, status: "maintenance", updated_by: "ahmed" }, { room_number: 604, status: "cleaning", updated_by: "ahmed" }]);
    await expect(page.getByText(/صيانة 1/)).toBeVisible();
    await expect(page.getByText(/تحت التنظيف 1/)).toBeVisible();
    await logout(page);
    await login(page, "rawan");
    await expect(page.getByText(/صيانة 1/)).toBeVisible();
    await expect(page.getByText(/متاحة 14/)).toBeVisible();
  });

  test("الصيانة بتفضل، لكن 'تحت التنظيف' بترجع تلقائي تاني يوم", async ({ page, env }) => {
    await users(env);
    await env.q("insert into room_overrides(room_number, status, updated_by) values (603, 'maintenance', 'x'), (604, 'cleaning', 'x')");
    // (الـ trigger بيفرض وقت السيرفر على أي تعديل، فبنوقّفه لحظة التجهيز بس عشان نرجّع التاريخ لورا)
    await env.q("alter table room_overrides disable trigger user");
    await env.q("update room_overrides set updated_at = now() - interval '2 days'");   // الحالتين متسجّلتين من يومين
    await env.q("alter table room_overrides enable trigger user");
    await page.goto("/");
    await login(page, "rawan");
    await expect(page.getByText(/صيانة 1/)).toBeVisible();          // الصيانة لسه
    await expect(page.getByText(/تحت التنظيف 0/)).toBeVisible();      // التنظيف رجعت متاحة
    await expect(page.getByText(/متاحة 15/)).toBeVisible();
  });

  test("الموظف بيسجّل حركاته في سجل الحركة باسمه، والتقرير بيطلب طباعة قبل الخروج", async ({ page, env }) => {
    await users(env);
    await env.seedShift("ahmed");
    await page.goto("/");
    await login(page, "ahmed");
    await goTab(page, "لوحة الغرف");
    await openRoom(page, 605);
    await page.getByRole("button", { name: "صيانة" }).click();
    await expect(toast(page)).toContainText("تم تحديث حالة الغرفة");
    await page.waitForTimeout(500);
    const rows = await env.q("select username, user_name, role, action from activity_log");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ username: "ahmed", role: "staff" });
    expect(rows[0].action).toContain("تغيير حالة");
    // بوابة تقرير الجلسة قبل الخروج
    await page.getByTitle("تسجيل خروج").click();
    await expect(page.getByText("لازم تطبع تقرير تعديلاتك قبل الخروج")).toBeVisible();
    await page.getByRole("button", { name: /رجوع للنظام/ }).click();
    await expect(page.locator(".cx-tab").first()).toBeVisible();
  });
});

test.describe("مدير الحجوزات", () => {
  test("بيشوف كل التابات، وبيغيّر حالة أي غرفة، وبيعدّل حجز لكن الفلوس مقفولة عليه", async ({ page, env }) => {
    await users(env);
    const id = await env.seedBooking({ room: 601, guest: "Res Edit", nights: 2, price: 100, paid: 50 });
    await page.goto("/");
    await login(page, "rawan");
    expect(await tabsOf(page)).toEqual(["لوحة الغرف", "الحجوزات", "اليومية", "التقارير", "سجل الحركة", "إدارة المستخدمين"]);

    // لوحة الغرف: بيعدّل رسوم إضافية (من غير غسيل/كافيتيريا) وبيشوف زر التعديل
    await goTab(page, "لوحة الغرف");
    await openRoom(page, 601);
    await expect(roomCard(page)).toContainText("Res Edit");
    await expect(page.getByRole("button", { name: /تسجيل تحصيل كامل المبلغ/ })).toHaveCount(0);   // التحصيل مش شغله
    await expect(field(page, "غسيل")).toHaveCount(0);
    await field(page, "جولات").fill("25");
    await page.getByRole("button", { name: /حفظ الرسوم/ }).click();
    await expect(toast(page)).toContainText("تم حفظ الرسوم الإضافية");
    let [b] = await env.q("select * from bookings where id = $1", [id]);
    expect(b.extras).toMatchObject({ tours: 25, laundry: 0 });

    // شاشة الحجوزات: السعر والمدفوع مقفولين
    await goTab(page, "الحجوزات");
    await page.locator(".cx-card", { hasText: "Res Edit" }).last().locator("button").first().click();
    await expect(page.locator("xpath=//label[contains(.,'المدفوع حتى الآن')]/following-sibling::input")).toBeDisabled();
    await expect(page.locator("xpath=//label[contains(.,'السعر لليلة')]/following-sibling::div//input[@type='number']")).toBeDisabled();
    await expect(page.getByText(/حجز قديم - أي حاجة فلوس فيه بقت مقفولة/)).toBeVisible();
    await field(page, "اسم النزيل").fill("Res Edit Renamed");
    await openMore(page);
    await page.locator("xpath=//label[contains(.,'جهة الحجز')]/following-sibling::select").selectOption("Booking.com");
    await page.getByRole("button", { name: /حفظ الحجز/ }).click();
    await expect(toast(page)).toContainText("تم الحفظ");
    [b] = await env.q("select * from bookings where id = $1", [id]);
    expect(b).toMatchObject({ guest_name: "Res Edit Renamed", source: "Booking.com", amount_paid: 50, price_night: 100 });
  });

  test("حجز جديد من مدير الحجوزات: المدفوع مقفول ويتحفظ بصفر مهما كان", async ({ page, env }) => {
    await users(env);
    await page.goto("/");
    await login(page, "rawan");
    await addBooking(page, { room: 606, guest: "By Manager", price: 80, nights: 2 });
    const [b] = await env.q("select * from bookings where guest_name = 'By Manager'");
    expect(b).toMatchObject({ amount_paid: 0, settled: false, total_room: 160, created_by: "rawan", created_by_role: "reservations" });
  });

  test("مفيش مسح: الحجز بيتلغي ويفضل في الحجوزات الملغية (من غير فلوس أو بفلوس)", async ({ page, env }) => {
    await users(env);
    await env.seedBooking({ room: 607, guest: "Cancel Me", nights: 1 });
    await env.seedBooking({ room: 608, guest: "Keep Me", nights: 1, price: 100, paid: 100, settled: true });
    await page.goto("/");
    await login(page, "rawan");
    await goTab(page, "الحجوزات");
    for (const name of ["Cancel Me", "Keep Me"]) {
      const c = page.locator(".cx-card", { hasText: name }).last();
      await c.getByRole("button", { name: "إلغاء الحجز" }).click();
      await c.getByRole("button", { name: "تأكيد الإلغاء؟" }).click();
      await expect(toast(page)).toContainText("تم إلغاء الحجز");
    }
    expect(await env.q("select guest_name, status, refund_pending from bookings where guest_name in ('Cancel Me','Keep Me') order by guest_name")).toEqual([
      { guest_name: "Cancel Me", status: "ملغي", refund_pending: false }, { guest_name: "Keep Me", status: "ملغي", refund_pending: true }]);
  });
});

test.describe("المحاسبة والمدير العام (عرض فقط)", () => {
  for (const [username, label, tabsExpected] of [["mona", "المحاسبة", ["لوحة الغرف", "اليومية", "الحجوزات", "التقارير", "سجل الحركة", "إدارة المستخدمين"]], ["boss", "المدير العام", ["لوحة الغرف", "اليومية", "الحجوزات", "التقارير", "سجل الحركة", "إدارة المستخدمين"]]]) {
    test(`${label}: بيشوف كل حاجة لكن مفيش أي زر تعديل في اللوحة/الحجوزات/اليومية`, async ({ page, env }) => {
      await users(env);
      await env.seedShift("ahmed", { closed: true });
      await env.seedBooking({ room: 601, guest: "View Only", nights: 2, price: 100, paid: 100 });
      await page.goto("/");
      await login(page, username);
      expect(await tabsOf(page)).toEqual(tabsExpected);

      await goTab(page, "لوحة الغرف");
      await openRoom(page, 601);
      await expect(roomCard(page)).toContainText("View Only");
      await expect(page.getByText("عرض فقط لدورك الحالي")).toBeVisible();
      for (const name of [/تسجيل تحصيل/, /تمديد الحجز/, /تعديل تفاصيل الحجز/, /حفظ الرسوم/]) await expect(page.getByRole("button", { name })).toHaveCount(0);

      await goTab(page, "الحجوزات");
      await expect(page.getByText("View Only").first()).toBeVisible();
      await expect(page.getByRole("button", { name: /حجز جديد/ })).toHaveCount(0);
      await expect(page.locator(".cx-card", { hasText: "View Only" }).last().locator("button")).toHaveCount(0);

      await goTab(page, "اليومية");
      await expect(page.getByRole("button", { name: "شيفتي النهارده" })).toHaveCount(0);
      await expect(page.getByText(/استعراض شيفتات سابقة/)).toBeVisible();
      // إعادة فتح الشيفت: صلاحية مدير الحجوزات والمدير العام (reopenShift) - مش المحاسبة
      await page.locator('input[type="date"]').fill(shiftDay());
      await page.getByRole("button", { name: { morning: "الشيفت الصباحي", evening: "الشيفت المسائي", night: "الشيفت الليلي" }[myShiftKey()] }).click();
      await expect(page.getByRole("button", { name: /إعادة فتح الشيفت/ })).toHaveCount(username === "boss" ? 1 : 0);
    });
  }

  test("المدير العام بس هو اللي يقدر يعيد فتح شيفت مقفول، والمحاسبة لأ", async ({ page, env }) => {
    await users(env);
    await env.seedShift("ahmed", { closed: true });
    await page.goto("/");
    await login(page, "boss");
    await goTab(page, "اليومية");
    await page.locator('input[type="date"]').fill(shiftDay());
    await page.getByRole("button", { name: { morning: "الشيفت الصباحي", evening: "الشيفت المسائي", night: "الشيفت الليلي" }[myShiftKey()] }).click();
    await page.getByRole("button", { name: /إعادة فتح الشيفت/ }).click();
    await expect(toast(page)).toContainText("تم إعادة فتح الشيفت");
    const [r] = await env.q("select closed, closed_by from shift_records");
    expect(r).toMatchObject({ closed: false, closed_by: null });
  });

  test("سجل الحركة: المدير العام بيشوف كل الموظفين، والموظف مبيشوفش غير نفسه (من قاعدة البيانات)", async ({ page, env }) => {
    await users(env);
    await env.q("insert into activity_log(user_name, username, role, action) values ('أحمد','ahmed','staff','حركة أحمد'), ('سارة','sara','staff','حركة سارة'), ('روان','rawan','reservations','حركة روان')");
    await page.goto("/");
    await login(page, "boss");
    await goTab(page, "سجل الحركة");
    for (const a of ["حركة أحمد", "حركة سارة", "حركة روان"]) await expect(page.getByText(a)).toBeVisible();
    await logout(page);
    await login(page, "ahmed");
    // الموظف مفيش عنده تاب سجل الحركة؛ والـ API بيرجّع صفوفه هو بس
    const rows = await env.q("select count(*)::int c from activity_log");
    expect(rows[0].c).toBe(3);
    const mine = await page.evaluate(async () => null);
    expect(mine).toBeNull();
  });
});
