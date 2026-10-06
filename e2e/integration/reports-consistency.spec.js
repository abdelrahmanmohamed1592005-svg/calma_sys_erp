// تطابق التقارير مع اليوميات والحجوزات: بيانات معقدة (٣ شيفتات، عملات ووسائل دفع
// مختلفة، حجوزات أونلاين ومباشرة، متبقي، رد معلّق) والأرقام المتوقعة بتتحسب هنا
// بشكل مستقل عن كود التطبيق ثم بتتقارن بالشاشة.
import { test, expect } from "../fixtures";
import { login, goTab, digits, shiftDay, cairoDate, myShiftKey } from "../ui";

const cur = (n) => n; // للوضوح
const order = (keys) => [...keys].sort((a, b) => (a === "EGP" ? -1 : b === "EGP" ? 1 : a === "USD" ? -1 : b === "USD" ? 1 : a.localeCompare(b)));
const line = (m) => { const ks = order(Object.keys(m).filter((k) => m[k] !== 0)); return ks.length ? ks.map((k) => `${m[k]}${k === "EGP" ? "ج" : k === "USD" ? "$" : k}`).join("+") : "0"; };
const add = (t, k, v) => { t[k] = (t[k] || 0) + v; };

// حساب إجماليات شيفت من صفوفه (بدون استخدام كود التطبيق)
function totalsOf(rows, cafeteria) {
  const t = { total_expenses: {}, total_collections: {}, cash_collections: {}, by_method_currency: {}, by_category: {} };
  for (const r of [...rows, cafeteria]) {
    const e = Number(r.expenseAmt) || 0;
    if (e > 0) { add(t.total_expenses, r.expenseCurrency, e); t.by_category[r.expenseCategory] ||= {}; add(t.by_category[r.expenseCategory], r.expenseCurrency, e); }
    const c = Number(r.collectionAmt) || 0;
    if (c !== 0) { add(t.total_collections, r.collectionCurrency, c); t.by_method_currency[r.collectionMethod] ||= {}; add(t.by_method_currency[r.collectionMethod], r.collectionCurrency, c); if (r.collectionMethod === "كاش") add(t.cash_collections, r.collectionCurrency, c); }
  }
  return t;
}
const col = (amt, method, currency, desc = "تحصيل") => ({ collectionAmt: amt, collectionMethod: method, collectionCurrency: currency, collectionDesc: desc });
const exp = (amt, cat, currency, desc = "مصروف") => ({ expenseAmt: amt, expenseCategory: cat, expenseCurrency: currency, expenseDesc: desc });

test("تقرير اليوم والفترة: كل رقم مطابق للحسابات المستقلة", async ({ page, env }) => {
  for (const [u, r] of [["boss", "gm"], ["ahmed", "staff"], ["sara", "staff"], ["omar", "staff"], ["rawan", "reservations"]]) await env.seedUser(u, r, u);
  const day = shiftDay();
  const base = (n) => Array.from({ length: 16 }, (_, i) => 601 + i)[n];

  // ---- الشيفتات (اليوم) ----
  const morning = { 601: col(100, "كاش", "USD"), 602: col(200, "فيزا", "EGP"), 603: exp(30, "كهرباء ومياه", "EGP") };
  const evening = { 604: col(50, "تحويل بنكي / انستاباي", "EUR"), 605: exp(20, "صيانة", "USD") };
  const night = { 605: col(70, "كاش", "EGP"), 606: col(-10, "كاش", "EGP", "رد فلوس") };
  const emptyRow = (room) => ({ room, expenseDesc: "", expenseAmt: "", expenseCategory: "أخرى", expenseCurrency: "EGP", collectionDesc: "", collectionAmt: "", collectionMethod: "كاش", collectionCurrency: "EGP", paymentDetails: {}, notes: "" });
  const rowsFor = (patch) => Array.from({ length: 16 }, (_, i) => ({ ...emptyRow(601 + i), ...(patch[601 + i] || {}) }));
  const cafeM = {}, cafeE = { ...col(15, "كاش", "EGP", "كافيتيريا") }, cafeN = { ...exp(5, "أخرى", "EGP", "مشتريات") };
  const cafeRow = (p) => ({ ...emptyRow("كافيتيريا"), ...p });

  await env.seedShift("ahmed", { key: "morning", day, closed: true, handover: { EGP: 1000 }, rowsPatch: morning, closingCash: { EGP: 970, USD: 100 }, stored: totalsOf(rowsFor(morning), cafeRow(cafeM)) });
  await env.seedShift("sara", { key: "evening", day, rowsPatch: evening, cafePatch: cafeE, flagged: true, notes: "مشكلة في الدرج" });
  await env.seedShift("omar", { key: "night", day, rowsPatch: night, cafePatch: cafeN });

  // ---- الحجوزات ----
  const online = { onlinePaid: true, commissionPct: 15, senderName: "", senderNumber: "", ref: "BK-1" };
  await env.seedBooking({ room: 607, guest: "Online One", start: 0, nights: 1, price: 500, total: 500, payment_details: online, source: "Booking.com" });
  await env.seedBooking({ room: 612, guest: "Online Extras", start: 0, nights: 1, price: 200, total: 200, payment_details: online, source: "Booking.com", extras: { laundry: 0, cafeteria: 0, tours: 50, pickup: 0 } });
  await env.seedBooking({ room: 608, guest: "Visa Direct", start: 0, nights: 1, price: 300, total: 300, paid: 300, settled: true, method: "فيزا", currency: "EGP" });
  await env.seedBooking({ room: 611, guest: "Cash Direct", start: 0, nights: 1, price: 100, total: 100, paid: 100, settled: true, method: "كاش", currency: "USD" });
  await env.seedBooking({ room: 609, guest: "Owes Money", start: -1, nights: 3, price: 100, total: 300 + 100, paid: 100, currency: "USD" });
  await env.seedBooking({ room: 613, guest: "Cancelled Kept", start: 0, nights: 1, price: 80, total: 80, paid: 80, method: "فيزا", currency: "EUR", status: "ملغي" });
  await env.qRaw("update bookings set refund_decision = 'kept' where guest_name = 'Cancelled Kept'");
  await env.seedBooking({ room: 610, guest: "Pending Refund", start: 0, nights: 1, price: 60, total: 60, paid: 60, currency: "USD", status: "ملغي" });
  await env.qRaw("update bookings set refund_pending = true where guest_name = 'Pending Refund'");

  // ---- الأرقام المتوقعة (مستقلة) ----
  const ledgerCollections = {};      // من اليوميات فقط
  const ledgerExpenses = {};
  const byMethod = {}, byCat = {}, cash = {};
  for (const [patch, cafe] of [[morning, cafeM], [evening, cafeE], [night, cafeN]]) {
    const t = totalsOf(rowsFor(patch), cafeRow(cafe));
    for (const [c, v] of Object.entries(t.total_collections)) add(ledgerCollections, c, v);
    for (const [c, v] of Object.entries(t.total_expenses)) add(ledgerExpenses, c, v);
    for (const [m, o] of Object.entries(t.by_method_currency)) { byMethod[m] ||= {}; for (const [c, v] of Object.entries(o)) add(byMethod[m], c, v); }
    for (const [m, o] of Object.entries(t.by_category)) { byCat[m] ||= {}; for (const [c, v] of Object.entries(o)) add(byCat[m], c, v); }
  }
  // تحصيل الحجوزات المباشر بغير الكاش (مش متسجّل في أي يومية) بيتضاف: فيزا ٣٠٠ جنيه + فيزا ٨٠ يورو (ملغي ومحتفظ بفلوسه)
  const direct = { "فيزا": { EGP: 300, EUR: 80 } };
  const combinedByMethod = JSON.parse(JSON.stringify(byMethod));
  for (const [m, o] of Object.entries(direct)) { combinedByMethod[m] ||= {}; for (const [c, v] of Object.entries(o)) add(combinedByMethod[m], c, v); }
  const combinedTotal = { ...ledgerCollections };
  for (const o of Object.values(direct)) for (const [c, v] of Object.entries(o)) add(combinedTotal, c, v);
  const net = {};
  for (const c of new Set([...Object.keys(ledgerCollections), ...Object.keys(ledgerExpenses)])) net[c] = (ledgerCollections[c] || 0) - (ledgerExpenses[c] || 0);
  const curOrder = order(new Set([...Object.keys(ledgerCollections), ...Object.keys(ledgerExpenses), ...Object.keys(net), ...Object.keys(combinedTotal)]));

  // ---- الشاشة: تقرير اليوم ----
  await page.goto("/");
  await login(page, "boss");
  await goTab(page, "التقارير");
  const grid = page.locator(".cx-report-grid").first();
  await expect(grid).toContainText("إجمالي التحصيل");
  const cardText = async (label) => digits(await grid.locator(".cx-card", { hasText: label }).first().innerText()).replace(label.replace(/\s/g, ""), "");
  expect(await cardText("إجمالي التحصيل")).toBe(line(combinedTotal));
  expect(await cardText("إجمالي المصاريف")).toBe(line(ledgerExpenses));
  expect(await cardText("صافي التحصيل بعد المصاريف")).toBe(line(net));
  // نسبة الإشغال: ٤ حجوزات نشطة النهارده (607, 608, 609, 611, 612 = ٥) من ١٦ غرفة
  const active = 5;
  expect(await cardText("متوسط نسبة الإشغال")).toBe(`${Math.round((active / 16) * 100)}%`);

  // جدول التحصيل حسب الوسيلة والعملة
  const methodTable = page.locator(".cx-card", { hasText: "التحصيل حسب طريقة الدفع والعملة" }).last().locator("table");
  for (const [m, o] of Object.entries(combinedByMethod)) {
    const row = methodTable.locator("tr", { hasText: m }).first();
    expect(digits(await row.innerText()), `وسيلة ${m}`).toBe(m.replace(/\s/g, "") + curOrder.map((c) => o[c] || 0).join(""));
  }
  // المصاريف حسب البند
  const catTable = page.locator(".cx-card", { hasText: "المصاريف حسب البند" }).last().locator("table");
  for (const [c, o] of Object.entries(byCat)) {
    expect(digits(await catTable.locator("tr", { hasText: c }).first().innerText()), `بند ${c}`).toBe(c.replace(/\s/g, "") + curOrder.map((k) => o[k] || 0).join(""));
  }
  // الأونلاين: إجمالي ٧٠٠ (٥٠٠ + ٢٠٠ + رسوم ٥٠) بالدولار، والصافي بعد ١٥٪
  const onlineGross = 500 + 250, onlineNet = (500 + 250) * 0.85;
  const onlineCard = page.locator(".cx-card", { hasText: "الحجوزات الأونلاين" }).last();
  const ot = digits(await onlineCard.innerText());
  expect(ot).toContain(`الإجماليمنغيرعمولة${onlineGross}$`);
  expect(ot).toContain(`الصافيبعدالعمولة${String(onlineNet).replace(".", "٫")}$`);      // ٦٣٧٫٥ (فاصلة عربية)
  // المتبقي على نزلاء: 609 → ٣٠٠$ (٤٠٠ - ١٠٠)، وحجز الأونلاين بتاع الرسوم → ٥٠$ بس
  const outstanding = digits(await page.locator(".cx-card", { hasText: "مبالغ متبقية على نزلاء" }).last().innerText());
  expect(outstanding).toContain("مبالغمتبقيةعلىنزلاء(2)");
  expect(outstanding).toContain("300USD");
  expect(outstanding).toContain("50USD");
  // رد معلّق
  const pend = digits(await page.locator(".cx-card", { hasText: "طلبات رد فلوس منتظرة" }).last().innerText());
  expect(pend).toContain("(1)");
  expect(pend).toContain("60USD");
  // متابعة الشيفتات
  await expect(page.getByText(/مشكلة في الدرج/)).toBeVisible();

  // ---- نفس الأرقام في تقرير الفترة (اليوم ده بس): لازم تتطابق مع تقرير اليوم ----
  await page.getByRole("button", { name: "فترة", exact: true }).click();
  const dates = page.locator('input[type="date"]');
  await dates.nth(0).fill(cairoDate(-3));
  await dates.nth(1).fill(day);
  await expect(grid.locator(".cx-card", { hasText: "إجمالي التحصيل" }).first()).toBeVisible();
  expect(await cardText("إجمالي التحصيل")).toBe(line(combinedTotal));
  expect(await cardText("إجمالي المصاريف")).toBe(line(ledgerExpenses));
});

test("مجموع تقارير الأيام = تقرير الفترة (من غير تكرار حجز أونلاين ولا تحصيل)", async ({ page, env }) => {
  for (const [u, r] of [["boss", "gm"], ["ahmed", "staff"], ["sara", "staff"]]) await env.seedUser(u, r, u);
  const d0 = shiftDay(), d1 = cairoDate(-1);
  const emptyRow = (room) => ({ room, expenseDesc: "", expenseAmt: "", expenseCategory: "أخرى", expenseCurrency: "EGP", collectionDesc: "", collectionAmt: "", collectionMethod: "كاش", collectionCurrency: "EGP", paymentDetails: {}, notes: "" });
  const rowsFor = (patch) => Array.from({ length: 16 }, (_, i) => ({ ...emptyRow(601 + i), ...(patch[601 + i] || {}) }));
  const p1 = { 601: col(100, "كاش", "USD"), 602: exp(40, "نظافة", "EGP") };
  const p0 = { 601: col(60, "كاش", "USD"), 603: col(25, "فيزا", "EGP") };
  await env.seedShift("sara", { key: "night", day: d1, closed: true, rowsPatch: p1, stored: totalsOf(rowsFor(p1), emptyRow("كافيتيريا")) });
  await env.seedShift("ahmed", { key: myShiftKey(), day: d0, rowsPatch: p0 });
  // حجز أونلاين ٣ ليالي بدأ امبارح: بيتحسب مرة واحدة بس (في يوم الدخول)
  await env.seedBooking({ room: 607, guest: "Online Multi", start: -1, nights: 3, price: 100, total: 300, payment_details: { onlinePaid: true, commissionPct: 10, senderName: "", senderNumber: "", ref: "" } });
  await page.goto("/");
  await login(page, "boss");
  await goTab(page, "التقارير");
  const grid = page.locator(".cx-report-grid").first();
  const read = async (label) => digits(await grid.locator(".cx-card", { hasText: label }).first().innerText()).replace(label.replace(/\s/g, ""), "");
  const dayInput = page.locator('input[type="date"]').first();
  const onlineNet = async () => digits(await page.locator(".cx-card", { hasText: "الحجوزات الأونلاين" }).last().innerText());

  await dayInput.fill(d1);
  await expect(grid.locator(".cx-card", { hasText: "إجمالي التحصيل" }).first()).toContainText("١٠٠");
  const t1 = await read("إجمالي التحصيل"), e1 = await read("إجمالي المصاريف"), o1 = await onlineNet();
  await dayInput.fill(d0);
  await expect(grid.locator(".cx-card", { hasText: "إجمالي التحصيل" }).first()).toContainText("٦٠");
  const t0 = await read("إجمالي التحصيل"), o0 = await onlineNet();
  expect(t1).toBe("100$"); expect(e1).toBe("40ج"); expect(t0).toBe("25ج+60$");
  expect(o1).toContain("270$");        // ٣٠٠ - ١٠٪ عمولة، في يوم الدخول (امبارح)
  expect(o0).not.toContain("270$");     // مش بيتكرر النهارده
  await page.getByRole("button", { name: "فترة", exact: true }).click();
  const dates = page.locator('input[type="date"]');
  await dates.nth(0).fill(d1);
  await dates.nth(1).fill(d0);
  await expect.poll(onlineNet).toContain("270$");
  expect(await read("إجمالي التحصيل")).toBe("25ج+160$");          // ١٠٠ + ٦٠ دولار، ٢٥ جنيه
  expect(await read("إجمالي المصاريف")).toBe("40ج");
  expect(await onlineNet()).toContain("270$");
});
