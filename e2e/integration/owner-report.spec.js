// تقرير الأونر: زرار في اليومية بيطلّع نفس ورق اليومية (كشف الغرف + ورقة الشيفت) من بيانات السيستم، وبيبعته صور.
import { test, expect } from "../fixtures";
import { login, goTab, toast } from "../ui";
import { mkdirSync } from "node:fs";

const OUT = process.env.OWNER_REPORT_OUT;   // لو متحدد: الصور والـ PDF بيتحفظوا هنا للمراجعة بالعين

async function seedDay(env) {
  await env.seedUser("boss", "gm", "المدير");
  await env.seedUser("ahmed", "staff", "أحمد");
  const b610 = await env.seedBooking({ room: 610, guest: "Guest 610", start: 0, nights: 4, price: 1600, paid: 3200, currency: "EGP", method: "فيزا", source: "Booking.com", anchor: "shift" });
  const b611 = await env.seedBooking({ room: 611, guest: "Guest 611", start: 0, nights: 1, price: 1600, paid: 1600, currency: "EGP", source: "مباشر", anchor: "shift" });
  await env.seedBooking({ room: 602, guest: "Guest 602", start: -1, nights: 3, price: 19, paid: 0, currency: "USD", source: "Booking.com", payment_details: { senderName: "", senderNumber: "", ref: "", onlinePaid: true }, anchor: "shift" });
  const b605 = await env.seedBooking({ room: 605, guest: "Guest 605", start: -1, nights: 2, price: 1700, paid: 200, currency: "EGP", extras: { laundry: 200, cafeteria: 0, tours: 0, pickup: 0 }, anchor: "shift" });
  await env.qRaw("update bookings set guest_codes = '[\"84\"]'::jsonb where id = $1", [b610]);
  await env.seedShift("ahmed", {
    handover: { EGP: 500 }, notes: "تم تسليم العهدة",
    collections: [{ room: 610, amount: 3200, method: "فيزا", currency: "EGP", bookingId: b610 }, { room: 611, amount: 1600, currency: "EGP", bookingId: b611 }, { room: 605, amount: 200, currency: "EGP", bookingId: b605 }],   // 605: دفع خدمة الغسيل = تحصيل على غرفته
    rowsPatch: { 610: { paymentDetails: { senderName: "", senderNumber: "1234", ref: "", onlinePaid: false } } },
  });
  await env.qRaw(`update shift_records set hotel_rows = $1::jsonb`, [JSON.stringify([{ room: "فندق", expenseDesc: "فاتورة كهرباء", expenseAmt: 70, expenseCategory: "كهرباء ومياه", expenseCurrency: "EGP", collectionDesc: "", collectionAmt: "", collectionMethod: "كاش", collectionCurrency: "EGP", paymentDetails: {}, notes: "" }])]);
}
const text = async (loc) => (await loc.innerText()).replace(/[⁦-⁩]/g, "");

test("موظف الشيفت: زرار إرسال اليومية للأونر بيطلّع كشف الغرف وورقة الشيفت وبيبعتهم صور", async ({ page, env }) => {
  await seedDay(env);
  await page.addInitScript(() => {
    window.__shared = null;
    navigator.canShare = (d) => !!(d && d.files && d.files.length);
    navigator.share = async (d) => { window.__shared = { title: d.title, files: d.files.map((f) => ({ name: f.name, type: f.type, size: f.size })) }; };
  });
  await page.goto("/");
  await login(page, "ahmed");
  await goTab(page, "اليومية");
  await page.getByTestId("owner-report-btn").click();

  const rooms = await text(page.getByTestId("owner-sheet-rooms"));
  expect(rooms).toContain("كشف الغرف");
  for (const col of ["رقم الغرفة", "رقم النزيل", "السعر × المدة", "دخول", "خروج", "خدمات", "إجمالي", "مدفوع", "ليالي مدفوعة", "متبقي", "التسكين"]) expect(rooms).toContain(col);
  await expect(page.getByTestId("owner-sheet-rooms").locator("tbody tr")).toHaveCount(16);       // كل غرف الفندق، الفاضي منها صف فاضي زي الورق
  const row = async (n) => text(page.getByTestId("owner-sheet-rooms").locator("tbody tr", { hasText: String(n) }).first());
  const r610 = await row(610);
  expect(r610).toContain("84");                    // رقم النزيل
  expect(r610).toContain("1,600 × 4");
  expect(r610).toContain("6,400 EGP");             // الإجمالي
  expect(r610).toContain("فيزا 3,200 ****1234");   // تفاصيل الدفع من اليومية
  expect(r610).toContain("2 من 4");                // دفع كام ليلة
  expect(r610).toContain("Booking.com");
  expect(await row(611)).toContain("خالص");
  expect(await row(602)).toContain("خالص (أونلاين)");
  const r605 = await row(605);
  expect(r605).toContain("غسيل 200 EGP");
  expect(r605).toContain("0 من 2");
  expect(r605).toContain("كاش 200");               // خدمة الغرفة اتدفعت = تحصيل على الغرفة
  expect(r605).toContain("3,400 EGP");             // متبقي = 3,400 + غسيل 200 - المدفوع 200
  expect(rooms).toContain("4 من 16");              // غرف مشغولة

  const sheets = page.locator("[data-testid^='owner-sheet-shift-']");
  await expect(sheets).toHaveCount(1);
  const shift = await text(sheets.first());
  expect(shift).toContain("أحمد");
  expect(shift).toContain("فيزا 3,200 EGP ****1234");
  expect(shift).toContain("كاش 1,600 EGP");
  expect(shift).toContain("فاتورة كهرباء 70 EGP");
  expect(await text(sheets.first().locator("tbody tr", { hasText: "605" }).first())).toContain("كاش 200 EGP");
  const box = async (label) => text(sheets.first().locator(".cx-or-sum > div", { hasText: label }).first().locator("dd"));
  expect(await box("العهدة")).toBe("500 EGP");
  expect(await box("إجمالي التحصيل")).toBe("5,000 EGP");
  expect(await box("إجمالي المصاريف")).toBe("70 EGP");
  expect(await box("رصيد الخزينة")).toBe("2,230 EGP");   // 500 + 1,800 كاش - 70
  expect(await box("الفيزا")).toBe("3,200 EGP");
  expect(shift).toContain("تم تسليم العهدة");

  const send = page.getByTestId("owner-report-send");
  await expect(send).toBeEnabled();
  await send.click();
  await expect(toast(page)).toContainText("المشاركة");
  const shared = await page.evaluate(() => window.__shared);
  expect(shared.files).toHaveLength(2);
  for (const f of shared.files) { expect(f.type).toBe("image/png"); expect(f.size).toBeGreaterThan(20000); }
  expect((await env.q("select count(*)::int n from activity_log where action like '%تقرير اليومية للأونر%'"))[0].n).toBe(1);

  if (OUT) {
    mkdirSync(OUT, { recursive: true });
    const downloads = [];
    page.on("download", (d) => downloads.push(d));
    await page.getByTestId("owner-report-download").click();
    await expect.poll(() => downloads.length).toBe(2);
    for (const d of downloads) await d.saveAs(`${OUT}/${d.suggestedFilename()}`);
    await page.screenshot({ path: `${OUT}/screen.png`, fullPage: false });
    await page.emulateMedia({ media: "print" });
    await page.pdf({ path: `${OUT}/print.pdf`, format: "A4" });
    await page.emulateMedia({ media: "screen" });
    await page.setViewportSize({ width: 390, height: 800 });
    await page.screenshot({ path: `${OUT}/mobile.png` });
    await page.setViewportSize({ width: 1280, height: 720 });
  }

  await page.getByTestId("owner-report-close").click();
  await expect(page.getByTestId("owner-report")).toHaveCount(0);
});

test("المدير العام: يفتح تقرير أي يوم من استعراض الشيفتات، والجهاز اللي مابيدعمش المشاركة بيحمّل الصور", async ({ page, env }) => {
  await seedDay(env);
  await page.addInitScript(() => { navigator.canShare = undefined; navigator.share = undefined; });
  await page.goto("/");
  await login(page, "boss");
  await goTab(page, "اليومية");
  await page.getByTestId("owner-report-btn").click();
  await expect(page.getByTestId("owner-sheet-rooms")).toBeVisible();
  await expect(page.locator("[data-testid^='owner-sheet-shift-']")).toHaveCount(1);
  const downloads = [];
  page.on("download", (d) => downloads.push(d));
  await expect(page.getByTestId("owner-report-send")).toBeEnabled();
  await page.getByTestId("owner-report-send").click();
  await expect.poll(() => downloads.length).toBe(2);
  await expect(toast(page)).toContainText("اتحمّلت");
});
