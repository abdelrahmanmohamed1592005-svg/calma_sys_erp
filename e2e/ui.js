// أدوات مشتركة لاختبارات الواجهة: الوقت بتوقيت القاهرة (زي التطبيق)، الدخول،
// حجز الشيفت، إضافة حجز من الشاشة، وتحويل الأرقام العربية.
import { expect } from "@playwright/test";

const CAIRO = "Africa/Cairo";
export function cairoDate(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: CAIRO, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
export const cairoHour = () => Number(new Intl.DateTimeFormat("en-GB", { timeZone: CAIRO, hour: "2-digit", hour12: false }).format(new Date())) % 24;
// يوم الشيفتات التشغيلي: قبل ٨ص بيتسجّل على امبارح (زي shiftDayNow في التطبيق)
export const shiftDay = () => (cairoHour() < 8 ? cairoDate(-1) : cairoDate(0));
export const myShiftKey = () => { const h = cairoHour(); return h >= 8 && h < 16 ? "morning" : h >= 16 ? "evening" : "night"; };
export const SHIFT_LABEL = { morning: "الشيفت الصباحي", evening: "الشيفت المسائي", night: "الشيفت الليلي" };

// أرقام التطبيق بتتعرض بالعربي (٢٠٠) وبفاصل آلاف (٢٬٠٠٠) - بنرجّعها لأرقام عادية للمقارنة
export const digits = (s) => String(s).replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d)).replace(/[٬,\s]/g, "");

export const tab = (page, label) => page.locator(".cx-tab").filter({ hasText: label });
export const goTab = (page, label) => tab(page, label).click();
export const field = (page, label) => page.locator(`xpath=//label[contains(normalize-space(.),'${label}')]/following-sibling::input[1]`);

export async function login(page, username, password = "Passw0rd1") {
  await page.locator("input").first().fill(username);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: "دخول", exact: true }).click();
  await expect(page.locator(".cx-tab").first()).toBeVisible();
}
export async function logout(page) {
  await page.getByTitle("تسجيل خروج").click();
  // لو عنده حركات النهارده بيطلب طباعة تقرير الجلسة الأول (window.print) - بنتخطاها
  const gate = page.getByRole("button", { name: /طباعة التقرير وتسجيل الخروج/ });
  if (await gate.isVisible().catch(() => false)) {
    await page.evaluate(() => { window.print = () => {}; });
    await gate.click();
  }
  await expect(page.getByRole("button", { name: "دخول", exact: true })).toBeVisible();
}
export async function loginAs(page, username, password) {
  await page.goto("/");
  await login(page, username, password);
}

// تحديث البيانات من قاعدة البيانات (الواجهة بتعمل ده لما التاب يرجع ظاهر)
export async function refresh(page) {
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await page.waitForTimeout(700);
}

export async function claimShift(page) {
  await goTab(page, "اليومية");
  await page.getByRole("button", { name: new RegExp(SHIFT_LABEL[myShiftKey()]) }).click();
  await expect(page.getByText("شيفتك الوحيد المتاح ليك النهارده")).toBeVisible();
}

export const toast = (page) => page.locator(".cx-toast");

/* بيضيف حجز من شاشة الحجوزات: بيدخل غرفة، اسم، تواريخ (بالفرق من النهارده)، سعر الليلة،
   والمدفوع/الوسيلة لو متحددين (الموظف بس بيقدر يكتب المدفوع). */
export async function addBooking(page, o) {
  const { room, guest, price = 100, nights = 1, startOffset = 0, paid, method, currency, dup = false, expectSaved = true } = o;
  await goTab(page, "الحجوزات");
  await page.getByRole("button", { name: /حجز جديد/ }).click();
  const form = page.locator(".cx-card[data-calma-editing]");
  await form.locator("select.cx-select").first().selectOption(String(room));
  await field(page, "اسم النزيل").fill(guest);
  await field(page, "تاريخ الدخول").fill(cairoDate(startOffset));
  await field(page, "تاريخ الخروج").fill(cairoDate(startOffset + nights));
  await page.locator("xpath=//label[contains(.,'السعر لليلة')]/following-sibling::div//input[@type='number']").fill(String(price));
  if (currency) await page.locator("xpath=//label[contains(.,'السعر لليلة')]/following-sibling::div//select").selectOption(currency);
  if (method) await page.locator("xpath=//label[contains(.,'طريقة الدفع')]/following-sibling::select").selectOption(method);
  if (paid != null) await page.locator("xpath=//label[contains(.,'المدفوع حتى الآن')]/following-sibling::input").fill(String(paid));
  await form.getByRole("button", { name: /حفظ الحجز/ }).click();
  if (expectSaved) {
    // الفورم بيتقفل بس بعد نجاح الحفظ (رسالة "تم الحفظ" ممكن تكون لسه ظاهرة من حفظة قبلها)
    await expect(form).toHaveCount(0);
    await expect(toast(page)).toContainText("تم الحفظ");
  }
}

export const boardTile = (page, room) => page.locator(".cx-tile", { hasText: String(room) });
export const roomCard = (page) => page.getByTestId("booking-card");

/* بيثبّت ساعة المتصفح على النهارده (بتاريخ القاهرة الفعلي) الساعة hh:mm بتوقيت القاهرة - عشان نختبر
   الأوفر تايم وعبور منتصف الليل والشيفت الليلي. تاريخ قاعدة البيانات (hotel_today) بيفضل الحقيقي،
   فنفس اليوم بالظبط والساعة بس هي اللي بتتغيّر. */
export async function setCairoTime(page, hour, minute = 0) {
  const [y, m, d] = cairoDate(0).split("-").map(Number);
  let t = Date.UTC(y, m - 1, d, hour, minute) - 3 * 3600000;       // تخمين (+٠٣:٠٠) ونصلّحه بالفرق الفعلي
  const cairoHM = (ms) => new Intl.DateTimeFormat("en-GB", { timeZone: CAIRO, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(ms)).split(":").map(Number);
  for (let i = 0; i < 3; i++) {
    const [h, mi] = cairoHM(t);
    const diff = (hour * 60 + minute) - ((h % 24) * 60 + mi);
    if (diff === 0) break;
    t += diff * 60000;
  }
  await page.clock.setFixedTime(new Date(t));
  return new Date(t);
}

// أقسام بطاقة الغرفة مطوية (خدمات/دخول مبكر، تمديد، أكواد، بيانات): بنفتح القسم قبل التعامل مع اللي جواه
export async function openSec(page, id) {
  const d = page.getByTestId(id);
  if (!(await d.evaluate((el) => el.open))) await d.locator("summary").click();
  return d;
}

// فتح بطاقة الغرفة (من اللوحة) مع فتح كل أقسامها المطوية
export async function openRoom(page, room) {
  await boardTile(page, room).click();
  await page.evaluate(() => document.querySelectorAll('[data-testid="booking-card"] details').forEach((d) => { d.open = true; }));
}
