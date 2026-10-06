// المستخدمين والأمان فوق قاعدة حقيقية: الإعداد الأول، إضافة/تعطيل/إعادة تعيين، وهجمات
// مباشرة على الـ API (من غير الواجهة) بهوية كل دور - قاعدة البيانات هي اللي بتقرر.
import { test, expect } from "../fixtures";
import { login, logout, goTab, field, toast, claimShift, refresh, cairoDate, shiftDay, myShiftKey } from "../ui";

async function users(env) {
  await env.seedUser("boss", "gm", "المدير");
  await env.seedUser("ahmed", "staff", "أحمد");
  await env.seedUser("sara", "staff", "سارة");
  await env.seedUser("rawan", "reservations", "روان");
  await env.seedUser("mona", "accounts", "منى");
}
// مرفوض = خطأ (٤xx) أو عملية كتابة مالمستش أي صف
const denied = (res) => res.status >= 400 || (Array.isArray(res.body) && res.body.length === 0);

test.describe("الإعداد الأول وإدارة المستخدمين", () => {
  test("أول مدير عام من شاشة الإعداد (RLS حقيقي)، وبعدها الشاشة مبتظهرش تاني", async ({ page, env }) => {
    await page.goto("/");
    await expect(page.getByText("الإعداد الأول - إنشاء حساب المدير العام")).toBeVisible();
    const inputs = page.locator("input");
    await inputs.nth(0).fill("المدير الأول");
    await inputs.nth(1).fill("owner");
    await inputs.nth(2).fill("Strong123");
    await inputs.nth(3).fill("Strong123");
    await page.getByRole("button", { name: /إنشاء الحساب والدخول/ }).click();
    await expect(page.locator(".cx-tab").first()).toBeVisible();
    const profiles = await env.q("select username, role, active from profiles");
    expect(profiles).toEqual([{ username: "owner", role: "gm", active: true }]);
    await logout(page);
    await expect(page.getByText("الإعداد الأول")).toHaveCount(0);
    await login(page, "owner", "Strong123");
  });

  test("المدير العام يضيف موظف: باسورد ضعيف/اسم مكرر بيترفضوا، والموظف الجديد يدخل", async ({ page, env }) => {
    await users(env);
    await page.goto("/");
    await login(page, "boss");
    await goTab(page, "إدارة المستخدمين");
    const open = async () => { await page.getByRole("button", { name: /مستخدم جديد/ }).click(); };
    const fill = async (name, user, pw, role) => {
      await field(page, "الاسم").fill(name); await field(page, "اسم المستخدم").fill(user); await field(page, "كلمة المرور").fill(pw);
      if (role) await page.locator("xpath=//label[contains(.,'الدور')]/following-sibling::select").selectOption(role);
      await page.getByRole("button", { name: /حفظ/ }).click();
    };
    await open();
    await fill("نور", "nour", "short1");
    await expect(toast(page)).toContainText("كلمة المرور ٨ حروف على الأقل");
    await fill("نور", "ahmed", "Strong123");
    await expect(toast(page)).toContainText("اسم المستخدم موجود بالفعل");
    await fill("نور", "nour", "Strong123", "accounts");
    await expect(toast(page)).toContainText("تم إنشاء الحساب");
    expect((await env.q("select role, active, name from profiles where username = 'nour'"))[0]).toEqual({ role: "accounts", active: true, name: "نور" });
    await logout(page);
    await login(page, "nour", "Strong123");
    expect(await page.locator(".cx-tab").count()).toBe(6);
  });

  test("إعادة تعيين كلمة مرور: الجديدة تدخل والقديمة لأ", async ({ page, env }) => {
    await users(env);
    await page.goto("/");
    await login(page, "boss");
    await goTab(page, "إدارة المستخدمين");
    const card = page.locator(".cx-card", { hasText: "@sara" });
    await card.getByRole("button", { name: /إعادة تعيين كلمة المرور/ }).click();
    await card.locator('input[type="password"]').fill("weak");
    await card.getByRole("button", { name: "حفظ" }).click();
    await expect(toast(page)).toContainText("٨ حروف");
    await card.locator('input[type="password"]').fill("BrandNew77");
    await card.getByRole("button", { name: "حفظ" }).click();
    await expect(toast(page)).toContainText("تم تغيير كلمة المرور");
    await logout(page);
    await page.locator("input").first().fill("sara");
    await page.locator('input[type="password"]').fill("Passw0rd1");
    await page.getByRole("button", { name: "دخول", exact: true }).click();
    await expect(page.getByText("بيانات الدخول غير صحيحة")).toBeVisible();
    await page.locator('input[type="password"]').fill("BrandNew77");
    await page.getByRole("button", { name: "دخول", exact: true }).click();
    await expect(page.locator(".cx-tab").first()).toBeVisible();
  });

  test("تغيير كلمة المرور الذاتي من الهيدر", async ({ page, env }) => {
    await users(env);
    await page.goto("/");
    await login(page, "ahmed");
    await page.getByTitle("تغيير كلمة المرور").click();
    const pw = page.locator('input[type="password"]');
    await pw.nth(0).fill("weak"); await pw.nth(1).fill("weak");
    await page.getByRole("button", { name: "حفظ" }).click();
    await expect(page.getByText("كلمة المرور ٨ حروف على الأقل")).toBeVisible();
    await pw.nth(0).fill("Changed99"); await pw.nth(1).fill("Different1");
    await page.getByRole("button", { name: "حفظ" }).click();
    await expect(page.getByText("كلمتا المرور غير متطابقتين")).toBeVisible();
    await pw.nth(1).fill("Changed99");
    await page.getByRole("button", { name: "حفظ" }).click();
    await expect(toast(page)).toContainText("تم تغيير كلمة المرور");
    await logout(page);
    await login(page, "ahmed", "Changed99");
  });

  test("تعطيل موظف: مايقدرش يدخل، والجلسة اللي مفتوحة بتفقد كل البيانات من قاعدة البيانات، وتفعيله يرجّعله الوصول", async ({ page, env }) => {
    await users(env);
    await env.seedBooking({ room: 601, guest: "Secret", nights: 1 });
    // جلسة الموظف مفتوحة بالفعل
    const staff = await env.newSession();
    await staff.goto("/");
    await login(staff, "ahmed");
    // المدير العام يعطّله
    await page.goto("/");
    await login(page, "boss");
    await goTab(page, "إدارة المستخدمين");
    const card = page.locator(".cx-card", { hasText: "@ahmed" });
    await card.getByRole("button", { name: "تعطيل" }).click();
    await card.getByRole("button", { name: "تأكيد التعطيل؟" }).click();
    await expect(toast(page)).toContainText("تم التحديث");
    expect((await env.q("select active from profiles where username = 'ahmed'"))[0].active).toBe(false);
    // نفس الجلسة اللي كانت مفتوحة: قاعدة البيانات بترجّع صفر صفوف (مش بتعتمد على الواجهة)
    for (const t of ["bookings", "rooms", "shift_records", "profiles", "activity_log"]) {
      const r = await env.api("ahmed", "GET", `/rest/v1/${t}?select=*`);
      expect(r.status === 200 && r.body.length === 0, `${t} لازم يرجّع فاضي لحساب معطّل`).toBe(true);
    }
    expect(denied(await env.api("ahmed", "POST", "/rest/v1/bookings", { room: 601, guest_name: "x", checkin: cairoDate(5), checkout: cairoDate(6) }))).toBe(true);
    // دخول جديد مرفوض
    await staff.reload();
    await expect(staff.getByRole("button", { name: "دخول", exact: true })).toBeVisible();
    // التفعيل تاني
    await card.getByRole("button", { name: "تفعيل" }).click();
    await expect(toast(page)).toContainText("تم التحديث");
    await login(staff, "ahmed");
    const ok = await env.api("ahmed", "GET", "/rest/v1/bookings?select=*");
    expect(ok.body).toHaveLength(1);
  });

  test("آخر مدير عام ما يتعطّلش (من الواجهة ومن الـ API)، ومدير عام تاني يتعطّل عادي", async ({ page, env }) => {
    await users(env);
    await page.goto("/");
    await login(page, "boss");
    await goTab(page, "إدارة المستخدمين");
    // مفيش زر تعطيل للنفس
    const selfCard = page.locator(".cx-card", { hasText: "@boss" });
    await selfCard.getByRole("button", { name: "تعطيل" }).click();
    await selfCard.getByRole("button", { name: "تأكيد التعطيل؟" }).click();
    await expect(toast(page)).toContainText("مينفعش تعطّل حسابك");
    const r = await env.api("boss", "PATCH", `/rest/v1/profiles?username=eq.boss`, { active: false });
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(r.body.message).toContain("مدير عام واحد");
    // تنزيل الدور برضه ممنوع
    const r2 = await env.api("boss", "PATCH", `/rest/v1/profiles?username=eq.boss`, { role: "staff" });
    expect(r2.status).toBeGreaterThanOrEqual(400);
    // مدير عام تاني: تعطيل الأول عادي بعد وجود التاني
    await env.seedUser("boss2", "gm", "مدير ٢");
    await refresh(page);
    const ok = await env.api("boss", "PATCH", `/rest/v1/profiles?username=eq.boss2`, { active: false });
    expect(ok.status).toBe(200);
  });

  test("المدير العام يلغي اختيار شيفت اتحجز بالغلط: الاختيار واليومية بيتمسحوا والموظف يقدر يحجز تاني", async ({ page, env }) => {
    await users(env);
    await env.seedShift("ahmed");
    await page.goto("/");
    await login(page, "boss");
    await goTab(page, "إدارة المستخدمين");
    await expect(page.getByText(/أحمد/).first()).toBeVisible();
    await page.getByRole("button", { name: "إلغاء الاختيار" }).click();
    await page.getByRole("button", { name: /مسح ورقة اليومية وإلغاء الاختيار/ }).click();
    await expect(toast(page)).toContainText("اتلغى الاختيار");
    expect(await env.q("select 1 from shift_claims")).toHaveLength(0);
    expect(await env.q("select 1 from shift_records")).toHaveLength(0);
    await logout(page);
    await login(page, "ahmed");
    await claimShift(page);
    expect(await env.q("select 1 from shift_claims")).toHaveLength(1);
  });
});

test("إلغاء اختيار شيفت مقفول: بيترفض برسالة (لازم تتفتح الأول) والاختيار واليومية بيفضلوا زي ما هم", async ({ page, env }) => {
  await users(env);
  await env.seedShift("ahmed", { closed: true });
  await page.goto("/");
  await login(page, "boss");
  await goTab(page, "إدارة المستخدمين");
  await page.getByRole("button", { name: "إلغاء الاختيار" }).click();
  await page.getByRole("button", { name: /مسح ورقة اليومية وإلغاء الاختيار/ }).click();
  await expect(toast(page)).toContainText("اليومية دي مقفولة");
  expect(await env.q("select 1 from shift_claims")).toHaveLength(1);
  expect(await env.q("select 1 from shift_records")).toHaveLength(1);
});

test.describe("هجمات مباشرة على الـ API (من غير الواجهة)", () => {
  test("زائر من غير تسجيل دخول: مفيش قراءة ولا كتابة ولا دوال", async ({ env }) => {
    await users(env);
    await env.seedBooking({ room: 601, guest: "G" });
    for (const t of ["bookings", "profiles", "rooms", "shift_records", "shift_claims", "activity_log", "room_overrides"]) {
      expect((await env.api(null, "GET", `/rest/v1/${t}?select=*`)).status, t).toBeGreaterThanOrEqual(400);
    }
    expect((await env.api(null, "POST", "/rest/v1/bookings", { room: 601, guest_name: "x", checkin: cairoDate(5), checkout: cairoDate(6) })).status).toBeGreaterThanOrEqual(400);
    expect((await env.api(null, "POST", "/rest/v1/rpc/is_gm", {})).status).toBeGreaterThanOrEqual(400);
    expect((await env.api(null, "POST", "/rest/v1/rpc/decide_booking_refund", { p_booking: "00000000-0000-0000-0000-000000000000", p_decision: "refund" })).status).toBeGreaterThanOrEqual(400);
    expect((await env.api(null, "POST", "/rest/v1/rpc/profiles_exist", {})).body).toBe(true);     // الوحيدة المفتوحة (شاشة الإعداد)
  });

  test("حساب مسجّل من غير بروفايل (تسجيل مفتوح) مايقدرش يعمل نفسه مدير عام ولا يشوف حاجة", async ({ env }) => {
    await users(env);
    const signup = await env.api(null, "POST", "/auth/v1/signup", { email: "evil@calma.internal", password: "Evil12345" });
    expect(signup.status).toBe(200);
    const evil = { id: signup.body.user.id };
    const r = await env.api(evil, "POST", "/rest/v1/profiles", { id: evil.id, username: "evil", name: "evil", role: "gm", active: true });
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect((await env.q("select 1 from profiles where username = 'evil'"))).toHaveLength(0);
    for (const t of ["bookings", "profiles", "rooms"]) expect((await env.api(evil, "GET", `/rest/v1/${t}?select=*`)).body, t).toEqual([]);
  });

  test("الموظف: تعديل مالي مباشر، إلغاء، حذف، انتحال، وحجز شيفتات بعيدة - كله مرفوض", async ({ env }) => {
    await users(env);
    const id = await env.seedBooking({ room: 601, guest: "Target", nights: 2, price: 100, paid: 200, settled: true });
    await env.seedShift("sara");           // يومية موظف تاني
    await env.seedShift("ahmed", { key: myShiftKey() === "morning" ? "evening" : "morning" });
    const A = (m, p, b) => env.api("ahmed", m, p, b);
    expect(denied(await A("PATCH", `/rest/v1/bookings?id=eq.${id}`, { price_night: 1 }))).toBe(true);
    expect(denied(await A("PATCH", `/rest/v1/bookings?id=eq.${id}`, { total_room: 1, settled: false }))).toBe(true);
    expect(denied(await A("PATCH", `/rest/v1/bookings?id=eq.${id}`, { status: "ملغي" }))).toBe(true);
    expect(denied(await A("DELETE", `/rest/v1/bookings?id=eq.${id}`))).toBe(true);
    expect(denied(await A("POST", "/rest/v1/bookings", { room: 602, guest_name: "ملغي", checkin: cairoDate(0), checkout: cairoDate(1), status: "ملغي" }))).toBe(true);
    expect(denied(await A("PATCH", `/rest/v1/profiles?username=eq.ahmed`, { role: "gm" }))).toBe(true);
    expect(denied(await A("PATCH", `/rest/v1/shift_records?staff_username=eq.sara`, { shift_notes: "اختراق" }))).toBe(true);
    expect(denied(await A("POST", "/rest/v1/shift_claims", { date: cairoDate(40), shift_key: "morning", username: "ahmed", name: "x" }))).toBe(true);
    expect(denied(await A("POST", "/rest/v1/rpc/decide_booking_refund", { p_booking: id, p_decision: "refund" }))).toBe(true);
    expect(denied(await A("PATCH", `/rest/v1/activity_log?username=eq.ahmed`, { action: "x" }))).toBe(true);
    expect(denied(await A("POST", "/rest/v1/room_overrides", { room_number: 602, status: "hacked" }))).toBe(true);
    // انتحال هوية في سجل الحركة: بيتسجّل باسمه الحقيقي
    const log = await A("POST", "/rest/v1/activity_log", { user_name: "المدير", username: "boss", role: "gm", action: "تزوير" });
    expect(log.status).toBe(201);
    expect(log.body[0]).toMatchObject({ username: "ahmed", role: "staff" });
    const [b] = await env.q("select price_night, total_room, status, amount_paid from bookings where id = $1", [id]);
    expect(b).toEqual({ price_night: 100, total_room: 200, status: "مؤكد", amount_paid: 200 });
  });

  test("المحاسبة والمدير العام: مفيش كتابة على الحجوزات/الغرف/اختيار الشيفتات/يومية مفتوحة", async ({ env }) => {
    await users(env);
    const id = await env.seedBooking({ room: 601, guest: "Target", nights: 1 });
    await env.seedShift("ahmed");
    for (const who of ["mona", "boss"]) {
      const A = (m, p, b) => env.api(who, m, p, b);
      expect(denied(await A("POST", "/rest/v1/bookings", { room: 602, guest_name: "x", checkin: cairoDate(3), checkout: cairoDate(4) })), `${who} insert booking`).toBe(true);
      expect(denied(await A("PATCH", `/rest/v1/bookings?id=eq.${id}`, { notes: "x" })), `${who} update booking`).toBe(true);
      expect(denied(await A("POST", "/rest/v1/room_overrides", { room_number: 603, status: "maintenance" })), `${who} override`).toBe(true);
      expect(denied(await A("PATCH", `/rest/v1/shift_records?staff_username=eq.ahmed`, { shift_notes: "x" })), `${who} open shift`).toBe(true);
      expect(denied(await A("POST", "/rest/v1/rpc/decide_booking_refund", { p_booking: id, p_decision: "refund" })), `${who} refund`).toBe(true);
      expect(denied(await A("POST", "/rest/v1/shift_claims", { date: cairoDate(0), shift_key: "evening", username: who, name: who })), `${who} claim`).toBe(true);
    }
  });

  test("مدير الحجوزات: ممنوع يلمس التحصيل أو يرد فلوس بره قرار الرد أو يمسح سجل", async ({ env }) => {
    await users(env);
    const id = await env.seedBooking({ room: 601, guest: "Target", nights: 2, price: 100, paid: 100 });
    const A = (m, p, b) => env.api("rawan", m, p, b);
    expect(denied(await A("PATCH", `/rest/v1/bookings?id=eq.${id}`, { amount_paid: 0 }))).toBe(true);
    expect(denied(await A("PATCH", `/rest/v1/bookings?id=eq.${id}`, { amount_paid: 500 }))).toBe(true);
    expect(denied(await A("PATCH", `/rest/v1/bookings?id=eq.${id}`, { settled: true }))).toBe(true);
    expect(denied(await A("DELETE", `/rest/v1/bookings?id=eq.${id}`))).toBe(true);        // عليه فلوس
    expect(denied(await A("DELETE", `/rest/v1/activity_log`))).toBe(true);
    expect(denied(await A("PATCH", `/rest/v1/shift_records`, { closed: true }))).toBe(true);
    const ok = await A("PATCH", `/rest/v1/bookings?id=eq.${id}`, { notes: "ملاحظة" });
    expect(ok.status).toBe(200);
  });
});
