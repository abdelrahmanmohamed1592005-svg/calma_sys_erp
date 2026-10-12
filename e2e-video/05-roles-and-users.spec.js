import { test, expect, say, pause, users, login, logout, goTab, toast, field, openRoom, claimShift, roomCard } from "./helpers";

const tabs = async (page) => page.locator(".cx-tab").allInnerTexts();

test("05 - الصلاحيات: كل دور بيشوف إيه ومينفعش يعمل إيه + إدارة المستخدمين وسجل الحركة", async ({ page, env }) => {
  await users(env);
  await env.seedBooking({ room: 601, guest: "نزيل للصلاحيات", nights: 2, price: 100, paid: 100 });
  await page.goto("/");

  await say(page, "١) موظف الشيفت: لوحة الغرف + اليومية + الحجوزات بس (من غير تقارير ولا مستخدمين)", 2200);
  await login(page, "ahmed"); await pause(page, 1800);
  expect((await tabs(page)).length).toBe(3);
  await say(page, "ومحتاج يختار شيفته الأول عشان يقدر يحصّل أو يضيف حجز", 2200);
  await goTab(page, "الحجوزات"); await pause(page, 1500);
  await say(page, "من غير شيفت: زرار 'حجز جديد' مخفي والتعديل ممنوع", 2600);
  await claimShift(page); await pause(page, 1200);
  await goTab(page, "لوحة الغرف"); await openRoom(page, 601);
  await say(page, "بعد اختيار الشيفت: يقدر يحصّل ويمدّد ويسجّل خروج مبكر ويضيف رسوم", 3000);
  await logout(page);

  await say(page, "٢) مدير الحجوزات (روان): كل التابات + بتحدد السعر، لكن التحصيل مش شغلها", 2200);
  await login(page, "rawan"); await pause(page, 1500);
  expect((await tabs(page)).length).toBe(6);
  await goTab(page, "لوحة الغرف"); await openRoom(page, 601); await pause(page, 1800);
  await say(page, "مفيش خانة تسجيل دفعة في بطاقة الغرفة (بس بتعدّل الرسوم وتغيّر حالة الغرفة)", 3000);
  await goTab(page, "الحجوزات");
  await page.locator(".cx-card", { hasText: "نزيل للصلاحيات" }).last().locator("button").first().click(); await pause(page, 1500);
  await say(page, "حجز قديم: السعر والمدفوع مقفولين عليها، وتقدر تعدّل الاسم والتواريخ وجهة الحجز", 3200);
  await page.getByRole("button", { name: "إلغاء", exact: true }).click();
  await say(page, "وبس هي اللي تلغي الحجوزات وتقرر رد الفلوس وتعيد فتح شيفت مقفول", 2600);
  await logout(page);

  await say(page, "٣) مديرة الحسابات (منى): قراءة بس - تقارير ويومية وسجل الحركة", 2200);
  await login(page, "mona"); await pause(page, 1500);
  await goTab(page, "الحجوزات");
  await say(page, "مفيش زرار حجز جديد ولا تعديل ولا إلغاء", 2400);
  expect(await page.getByRole("button", { name: /حجز جديد/ }).count()).toBe(0);
  await goTab(page, "سجل الحركة"); await say(page, "سجل الحركة: مين عمل إيه ومتى (آخر ٣٠٠ حركة)", 2800);
  await goTab(page, "إدارة المستخدمين"); await say(page, "قايمة المستخدمين للعرض بس عندها", 2400);
  await logout(page);

  await say(page, "٤) المدير العام: كل حاجة + إدارة المستخدمين", 2000);
  await login(page, "boss"); await goTab(page, "إدارة المستخدمين"); await pause(page, 1800);
  await say(page, "إضافة مستخدم: كلمة مرور ضعيفة مرفوضة", 1200);
  await page.getByRole("button", { name: /مستخدم جديد/ }).click();
  const fill = async (name, user, pw, role) => {
    await field(page, "الاسم").fill(name); await field(page, "اسم المستخدم").fill(user); await field(page, "كلمة المرور").fill(pw);
    if (role) await page.locator("xpath=//label[contains(.,'الدور')]/following-sibling::select").selectOption(role);
    await page.getByRole("button", { name: /حفظ/ }).click();
  };
  await fill("نور", "nour", "short1"); await pause(page, 2400);
  await say(page, "اسم مستخدم موجود بالفعل: مرفوض", 1200);
  await fill("نور", "ahmed", "Strong123"); await pause(page, 2400);
  await say(page, "بيانات سليمة: بيتعمل الحساب والموظف الجديد يدخل على طول", 1200);
  await fill("نور", "nour", "Strong123", "accounts"); await expect(toast(page)).toContainText("تم إنشاء الحساب"); await pause(page, 2600);
  await say(page, "إعادة تعيين كلمة مرور موظف (لازم قوية برضه)", 1500);
  const card = page.locator(".cx-card", { hasText: "@sara" });
  await card.getByRole("button", { name: /إعادة تعيين كلمة المرور/ }).click();
  await card.locator('input[type="password"]').fill("weak"); await card.getByRole("button", { name: "حفظ" }).click(); await pause(page, 2200);
  await card.locator('input[type="password"]').fill("BrandNew77"); await card.getByRole("button", { name: "حفظ" }).click(); await pause(page, 2600);
  await goTab(page, "سجل الحركة"); await say(page, "كل اللي حصل اتسجّل في سجل الحركة", 3000);
  await logout(page);
  await say(page, "٥) حساب موقوف مابيدخلش، وكلمة المرور القديمة بعد إعادة التعيين مابتشتغلش", 1500);
  await page.locator("input").first().fill("sara"); await page.locator('input[type="password"]').fill("Passw0rd1");
  await page.getByRole("button", { name: "دخول", exact: true }).click(); await pause(page, 2800);
});
