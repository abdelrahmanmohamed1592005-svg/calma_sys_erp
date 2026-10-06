import { test, expect } from "@playwright/test";
import { installFakeSupabase } from "./fakeSupabase";

// "النهارده" في كل الاختبارات: ١٠ صباحًا بتوقيت القاهرة => الشيفت الصباحي
const NOW = new Date("2026-10-06T10:00:00+03:00");
const USERS = [
  { username: "boss", password: "Passw0rd1", role: "gm", name: "المدير" },
  { username: "ahmed", password: "Passw0rd1", role: "staff", name: "أحمد" },
  { username: "mona", password: "Passw0rd1", role: "accounts", name: "منى" },
  { username: "rawan", password: "Passw0rd1", role: "reservations", name: "روان" },
];

async function open(page, opts = { users: USERS }) {
  await page.clock.setFixedTime(NOW);
  const store = await installFakeSupabase(page, opts);
  await page.goto("/");
  return store;
}
async function login(page, username, password = "Passw0rd1") {
  await page.locator("input").first().fill(username);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: "دخول", exact: true }).click();
}
const tabs = (page) => page.locator(".cx-tab");
const field = (page, label) => page.locator(`xpath=//label[contains(normalize-space(.),'${label}')]/following-sibling::input[1]`);

test.describe("تسجيل الدخول", () => {
  test("بيانات غلط بتظهر رسالة خطأ ومفيش دخول", async ({ page }) => {
    await open(page);
    await login(page, "boss", "WrongPass9");
    await expect(page.getByText("بيانات الدخول غير صحيحة")).toBeVisible();
    await expect(tabs(page)).toHaveCount(0);
  });

  test("الدخول الصحيح بيفتح التطبيق والخروج بيرجّع لشاشة الدخول", async ({ page }) => {
    await open(page);
    await login(page, "boss");
    await expect(page.getByText("المدير", { exact: true }).first()).toBeVisible();
    await expect(tabs(page).first()).toBeVisible();
    await page.getByTitle("تسجيل خروج").click();
    await expect(page.getByRole("button", { name: "دخول", exact: true })).toBeVisible();
  });

  test("حساب معطّل مينفعش يدخل", async ({ page }) => {
    const store = await open(page);
    store.profiles.find((p) => p.username === "ahmed").active = false;
    await login(page, "ahmed");
    await expect(page.getByRole("button", { name: "دخول", exact: true })).toBeVisible();
    await expect(tabs(page)).toHaveCount(0);
  });
});

test.describe("الصلاحيات حسب الدور (التابات)", () => {
  const cases = [
    ["gm", "boss", ["لوحة الغرف", "اليومية", "الحجوزات", "التقارير", "سجل الحركة", "إدارة المستخدمين"]],
    ["staff", "ahmed", ["لوحة الغرف", "اليومية", "الحجوزات"]],
    ["accounts", "mona", ["لوحة الغرف", "اليومية", "الحجوزات", "التقارير", "سجل الحركة", "إدارة المستخدمين"]],
    ["reservations", "rawan", ["لوحة الغرف", "الحجوزات", "اليومية", "التقارير", "سجل الحركة", "إدارة المستخدمين"]],
  ];
  for (const [role, username, expected] of cases) {
    test(`دور ${role}`, async ({ page }) => {
      await open(page);
      await login(page, username);
      await expect(tabs(page)).toHaveCount(expected.length);
      for (const label of expected) await expect(tabs(page).filter({ hasText: label })).toHaveCount(1);
    });
  }

  test("الموظف مايشوفش تاب التقارير ولا المستخدمين", async ({ page }) => {
    await open(page);
    await login(page, "ahmed");
    await expect(tabs(page).filter({ hasText: "التقارير" })).toHaveCount(0);
    await expect(tabs(page).filter({ hasText: "إدارة المستخدمين" })).toHaveCount(0);
  });
});

test.describe("إدارة المستخدمين", () => {
  test("المدير العام يضيف مستخدم، وكلمة مرور ضعيفة بتترفض", async ({ page }) => {
    const store = await open(page);
    await login(page, "boss");
    await tabs(page).filter({ hasText: "إدارة المستخدمين" }).click();
    await page.getByRole("button", { name: /مستخدم جديد/ }).click();
    await field(page, "الاسم").fill("سارة");
    await field(page, "اسم المستخدم").fill("sara");
    await field(page, "كلمة المرور").fill("weak");
    await page.getByRole("button", { name: /حفظ/ }).click();
    await expect(page.getByText("كلمة المرور ٨ حروف على الأقل")).toBeVisible();
    expect(store.functionCalls).toHaveLength(0);

    await field(page, "كلمة المرور").fill("Strong123");
    await page.getByRole("button", { name: /حفظ/ }).click();
    await expect(page.getByText("تم إنشاء الحساب")).toBeVisible();
    await expect(page.getByText("@sara")).toBeVisible();
    expect(store.functionCalls[0]).toMatchObject({ name: "create-user", body: { username: "sara", role: "staff" } });
  });

  test("المحاسبة بتشوف القائمة للعرض بس (من غير أزرار تعديل)", async ({ page }) => {
    await open(page);
    await login(page, "mona");
    await tabs(page).filter({ hasText: "إدارة المستخدمين" }).click();
    await expect(page.getByText("@boss")).toBeVisible();
    await expect(page.getByRole("button", { name: /مستخدم جديد/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /إعادة تعيين كلمة المرور/ })).toHaveCount(0);
  });

  test("المدير العام يعيد تعيين كلمة مرور موظف", async ({ page }) => {
    const store = await open(page);
    await login(page, "boss");
    await tabs(page).filter({ hasText: "إدارة المستخدمين" }).click();
    const card = page.locator(".cx-card", { hasText: "@ahmed" });
    await card.getByRole("button", { name: /إعادة تعيين كلمة المرور/ }).click();
    await card.locator('input[type="password"]').fill("NewPass456");
    await card.getByRole("button", { name: "حفظ" }).click();
    await expect(page.getByText("تم تغيير كلمة المرور")).toBeVisible();
    expect(store.functionCalls.at(-1)).toMatchObject({ name: "reset-password", body: { username: "ahmed", newPassword: "NewPass456" } });
  });
});

test.describe("شيفت الموظف والحجوزات", () => {
  test("الموظف بيحجز الشيفت الصباحي وبعدها يضيف حجز، والنص بيتنضّف", async ({ page }) => {
    const store = await open(page);
    await login(page, "ahmed");

    // من غير شيفت محجوز: مفيش زر "حجز جديد"
    await tabs(page).filter({ hasText: "الحجوزات" }).click();
    await expect(page.getByRole("button", { name: /حجز جديد/ })).toHaveCount(0);

    // حجز الشيفت (الساعة ١٠ ص => الصباحي بس هو المتاح)
    await tabs(page).filter({ hasText: "اليومية" }).click();
    await expect(page.getByRole("button", { name: /الشيفت المسائي/ })).toBeDisabled();
    await page.getByRole("button", { name: /الشيفت الصباحي/ }).click();
    await expect(page.getByText("شيفتك الوحيد المتاح ليك النهارده")).toBeVisible();
    expect(store.shift_claims).toHaveLength(1);
    expect(store.shift_records).toHaveLength(1);

    // إضافة حجز
    await tabs(page).filter({ hasText: "الحجوزات" }).click();
    await page.getByRole("button", { name: /حجز جديد/ }).click();
    await page.locator("select.cx-select").first().selectOption("601");
    await field(page, "اسم النزيل").fill("  Ali\u0007 Hassan  ");
    await page.locator("xpath=//label[contains(.,'السعر لليلة')]/following-sibling::div//input[@type='number']").fill("50");
    await page.getByRole("button", { name: /حفظ الحجز/ }).click();
    await expect(page.getByText(/تم الحفظ/)).toBeVisible();
    await expect(page.getByText("Ali Hassan", { exact: false }).first()).toBeVisible();

    expect(store.bookings).toHaveLength(1);
    expect(store.bookings[0]).toMatchObject({ room: 601, guest_name: "Ali Hassan", price_night: 50, total_room: 50, checkin: "2026-10-06", checkout: "2026-10-07", created_by: "ahmed" });
  });

  test("حجز من غير اسم نزيل أو غرفة بيترفض ومبيتبعتش", async ({ page }) => {
    const store = await open(page);
    await login(page, "ahmed");
    await tabs(page).filter({ hasText: "اليومية" }).click();
    await page.getByRole("button", { name: /الشيفت الصباحي/ }).click();
    await expect(page.getByText("شيفتك الوحيد المتاح ليك النهارده")).toBeVisible();
    await tabs(page).filter({ hasText: "الحجوزات" }).click();
    await page.getByRole("button", { name: /حجز جديد/ }).click();
    await page.getByRole("button", { name: /حفظ الحجز/ }).click();
    await expect(page.getByText("لازم تحدد الغرفة واسم النزيل")).toBeVisible();
    expect(store.bookings).toHaveLength(0);
  });

  test("حجز متعارض مع حجز موجود بيتحذّر منه ومبيتحفظش من غير تأكيد", async ({ page }) => {
    const store = await open(page);
    store.bookings.push({ id: "b1", room: 601, guest_name: "نزيل قديم", checkin: "2026-10-06", checkout: "2026-10-09", price_night: 40, currency: "USD", total_room: 120, pax: 1, status: "مؤكد", approval_status: "approved", extras: { laundry: 0, cafeteria: 0, tours: 0, pickup: 0 }, early_checkin: { applied: false, fee: 0, note: "" }, payment_details: {}, payment_method: "كاش", source: "مباشر", amount_paid: 0, amount_tendered: 0, settled: false, notes: "", created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
    await login(page, "ahmed");
    await tabs(page).filter({ hasText: "اليومية" }).click();
    await page.getByRole("button", { name: /الشيفت الصباحي/ }).click();
    await expect(page.getByText("شيفتك الوحيد المتاح ليك النهارده")).toBeVisible();
    await tabs(page).filter({ hasText: "الحجوزات" }).click();
    await page.getByRole("button", { name: /حجز جديد/ }).click();
    await page.locator("select.cx-select").first().selectOption("601");
    await field(page, "اسم النزيل").fill("نزيل جديد");
    await expect(page.getByText(/محجوزة بالفعل في تواريخ متداخلة/)).toBeVisible();
    await page.getByRole("button", { name: /حفظ الحجز/ }).click();
    await expect(page.getByText(/الغرفة متعارضة مع حجز موجود/)).toBeVisible();
    expect(store.bookings).toHaveLength(1);
  });
});

test.describe("لوحة الغرف", () => {
  test("الغرفة بتظهر مشغولة لما يكون عليها حجز نشط النهارده", async ({ page }) => {
    const store = await open(page);
    store.bookings.push({ id: "b2", room: 602, guest_name: "نزيلة اليوم", checkin: "2026-10-05", checkout: "2026-10-08", price_night: 40, currency: "USD", total_room: 120, pax: 1, status: "مؤكد", approval_status: "approved", extras: { laundry: 0, cafeteria: 0, tours: 0, pickup: 0 }, early_checkin: { applied: false, fee: 0, note: "" }, payment_details: {}, payment_method: "كاش", source: "مباشر", amount_paid: 0, amount_tendered: 0, settled: false, notes: "", created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
    await login(page, "boss");
    await expect(page.getByText("نزيلة اليوم")).toBeVisible();
    await expect(page.getByText(/مشغولة - متبقي فلوس 1/)).toBeVisible();
  });
});

test.describe("التقارير", () => {
  test("فترة مقلوبة بتظهر رسالة بدل ما تعلّق الشاشة", async ({ page }) => {
    await open(page);
    await login(page, "boss");
    await tabs(page).filter({ hasText: "التقارير" }).click();
    await page.getByRole("button", { name: "فترة", exact: true }).click();
    const dates = page.locator('input[type="date"]');
    await dates.nth(0).fill("2026-10-10");
    await dates.nth(1).fill("2026-10-01");
    await expect(page.getByText("تاريخ البداية لازم يكون قبل تاريخ النهاية")).toBeVisible();
  });

  test("فترة أطول من سنة بتترفض", async ({ page }) => {
    await open(page);
    await login(page, "boss");
    await tabs(page).filter({ hasText: "التقارير" }).click();
    await page.getByRole("button", { name: "فترة", exact: true }).click();
    const dates = page.locator('input[type="date"]');
    await dates.nth(0).fill("2020-01-01");
    await dates.nth(1).fill("2026-10-01");
    await expect(page.getByText(/أقصى فترة للتقرير/)).toBeVisible();
  });

  test("تقرير يوم عادي بيحمّل ويعرض الشيفتات", async ({ page }) => {
    await open(page);
    await login(page, "boss");
    await tabs(page).filter({ hasText: "التقارير" }).click();
    await expect(page.getByText("إجمالي التحصيل").first()).toBeVisible();
    await expect(page.getByText("لا يوجد سجل").first()).toBeVisible();
  });
});

test.describe("شاشة الإعداد الأول", () => {
  test("قاعدة فاضية: بتظهر شاشة الإعداد وبتتحقق من الباسورد", async ({ page }) => {
    await open(page, { users: [] });
    await expect(page.getByText("الإعداد الأول - إنشاء حساب المدير العام")).toBeVisible();
    const inputs = page.locator("input");
    await inputs.nth(0).fill("المدير");
    await inputs.nth(1).fill("owner");
    await inputs.nth(2).fill("short1");
    await inputs.nth(3).fill("short1");
    await page.getByRole("button", { name: /إنشاء الحساب والدخول/ }).click();
    await expect(page.getByText("كلمة المرور ٨ حروف على الأقل")).toBeVisible();
    await inputs.nth(2).fill("Strong123");
    await inputs.nth(3).fill("Different9");
    await page.getByRole("button", { name: /إنشاء الحساب والدخول/ }).click();
    await expect(page.getByText("كلمتا المرور غير متطابقتين")).toBeVisible();
  });

  test("إنشاء أول مدير عام بنجاح ودخول التطبيق", async ({ page }) => {
    const store = await open(page, { users: [] });
    const inputs = page.locator("input");
    await inputs.nth(0).fill("المدير الجديد");
    await inputs.nth(1).fill("owner");
    await inputs.nth(2).fill("Strong123");
    await inputs.nth(3).fill("Strong123");
    await page.getByRole("button", { name: /إنشاء الحساب والدخول/ }).click();
    await expect(tabs(page).first()).toBeVisible();
    expect(store.profiles).toHaveLength(1);
    expect(store.profiles[0]).toMatchObject({ username: "owner", role: "gm", active: true });
  });

  test("لما فيه مستخدمين بالفعل مبتظهرش شاشة الإعداد", async ({ page }) => {
    await open(page);
    await expect(page.getByText("الإعداد الأول")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "دخول", exact: true })).toBeVisible();
  });
});

test.describe("اتصال التطبيق", () => {
  test("مفيش أي طلب خرج لمشروع Supabase حقيقي", async ({ page }) => {
    const external = [];
    page.on("request", (r) => { if (/supabase\.co/.test(r.url())) external.push(r.url()); });
    await open(page);
    await login(page, "boss");
    await expect(tabs(page).first()).toBeVisible();
    expect(external).toEqual([]);
  });
});
