// اليومية والشيفتات: حجز الشيفت، نقل العهدة، التعديل، الأرصدة، القفل، إعادة الفتح،
// وظهور ده كله في لوحة الغرف والتقارير - فوق قاعدة بيانات حقيقية.
import { test, expect } from "../fixtures";
import { login, logout, goTab, claimShift, toast, boardTile, digits, shiftDay, myShiftKey, cairoDate, SHIFT_LABEL, refresh } from "../ui";

async function users(env) {
  await env.seedUser("boss", "gm", "المدير");
  await env.seedUser("ahmed", "staff", "أحمد");
  await env.seedUser("sara", "staff", "سارة");
  await env.seedUser("rawan", "reservations", "روان");
  await env.seedUser("mona", "accounts", "منى");
}
const ORDER = ["morning", "evening", "night"];
const prevOf = (day, key) => { const i = ORDER.indexOf(key); if (i > 0) return { day, key: ORDER[i - 1] }; const d = new Date(day + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() - 1); return { day: d.toISOString().slice(0, 10), key: "night" }; };
const roomRow = (page, num) => page.locator("table.cx-table tbody tr", { hasText: String(num) }).first();
const cafeRow = (page) => page.locator("table.cx-table tbody tr", { hasText: "كافيتيريا" }).last();
const ledger = async (env) => (await env.q("select * from shift_records where staff_username = 'ahmed'"))[0];
const waitSaved = async (page) => page.waitForTimeout(1300);   // التعديلات بتتبعت بعد ٧٠٠ms من آخر كتابة
// بلوك العملة/الوسيلة في ملخص اليومية (أعمق div فيه العنوان بالظبط)
const block = (page, title) => page.locator(`xpath=//div[./div[normalize-space(.)='${title}']]`).last();

test.describe("حجز الشيفت", () => {
  test("الموظف يحجز شيفته، والشيفتات التانية مقفولة، وموظف تاني مايقدرش ياخد نفس الشيفت", async ({ page, env }) => {
    await users(env);
    await page.goto("/");
    await login(page, "ahmed");
    await goTab(page, "اليومية");
    const mine = myShiftKey();
    for (const k of ORDER.filter((x) => x !== mine)) await expect(page.getByRole("button", { name: new RegExp(SHIFT_LABEL[k]) })).toBeDisabled();
    await page.getByRole("button", { name: new RegExp(SHIFT_LABEL[mine]) }).click();
    await expect(page.getByText("شيفتك الوحيد المتاح ليك النهارده")).toBeVisible();
    const [claim] = await env.q("select * from shift_claims");
    expect(claim).toMatchObject({ date: shiftDay(), shift_key: mine, username: "ahmed", name: "أحمد" });
    const rec = await ledger(env);
    expect(rec).toMatchObject({ date: shiftDay(), shift_key: mine, staff_name: "أحمد", closed: false });
    expect(rec.rows).toHaveLength(16);
    await logout(page);

    await login(page, "sara");
    await goTab(page, "اليومية");
    await expect(page.getByRole("button", { name: new RegExp(SHIFT_LABEL[mine]) })).toBeDisabled();
    await expect(page.getByText("اتاخد بواسطة أحمد")).toBeVisible();
  });

  test("العهدة بتتنقل من إقفال الشيفت اللي قبله (كاش بكل عملاته ووسائل الدفع التانية)", async ({ page, env }) => {
    await users(env);
    const p = prevOf(shiftDay(), myShiftKey());
    await env.seedShift("sara", { day: p.day, key: p.key, closed: true, closingCash: { EGP: 777, USD: 5 }, methodClosing: { "فيزا": { EGP: 90 } } });
    await page.goto("/");
    await login(page, "ahmed");
    await claimShift(page);
    const rec = await ledger(env);
    expect(rec.handover).toEqual({ EGP: 777, USD: 5 });
    expect(rec.method_handover).toEqual({ "فيزا": { EGP: 90 } });
    expect(digits(await page.locator("body").innerText())).toContain("777");
  });

  test("الموظف الجديد بيبدأ → الشيفت اللي قبله (لو لسه مفتوح) بيتقفل تلقائي وعهدته بتتنقل", async ({ page, env }) => {
    await users(env);
    const p = prevOf(shiftDay(), myShiftKey());
    await env.seedShift("sara", { day: p.day, key: p.key, collections: [{ room: 601, amount: 100, method: "كاش", currency: "USD" }] });
    await env.q("update shift_records set handover = $1::jsonb where staff_username = 'sara'", [JSON.stringify({ EGP: 50 })]);
    await page.goto("/");
    await login(page, "ahmed");
    await claimShift(page);
    const prev = (await env.q("select * from shift_records where staff_username = 'sara'"))[0];
    expect(prev.closed).toBe(true);
    expect(prev.closed_by).toContain("إقفال تلقائي");
    expect(prev.closing_cash).toEqual({ EGP: 50, USD: 100 });
    expect((await ledger(env)).handover).toEqual({ EGP: 50, USD: 100 });
  });
});

test.describe("تعبئة اليومية وأرصدتها وقفلها", () => {
  test("مصاريف وتحصيل بعملات مختلفة: الأرصدة، الحفظ، القفل، وإعادة الفتح من مدير الحجوزات", async ({ page, env }) => {
    await users(env);
    await page.goto("/");
    await login(page, "ahmed");
    await claimShift(page);

    // مصروف ٥٠ جنيه (نظافة) + تحصيل كاش ٣٠٠ دولار على غرفة 601 + تحصيل كافيتيريا ٢٠ جنيه
    const r601 = roomRow(page, 601);
    await r601.locator("select.cx-select").nth(0).selectOption("نظافة");
    await r601.getByPlaceholder("البيان", { exact: true }).fill("مناديل");
    await r601.getByPlaceholder("المبلغ").nth(0).fill("50");
    await r601.getByPlaceholder("بيان التحصيل").fill("حجز مباشر");
    await r601.getByPlaceholder("المبلغ").nth(1).fill("300");
    await r601.locator("select.cx-select").nth(3).selectOption("USD");
    const cafe = cafeRow(page);
    await cafe.getByPlaceholder("المبلغ").nth(1).fill("20");
    await page.getByRole("spinbutton").filter({ hasNot: page.locator("x") }).first();   // (لا شيء - بس بنتأكد إن الصفحة لسه شغالة)
    await waitSaved(page);

    let rec = await ledger(env);
    const row = rec.rows.find((r) => r.room === 601);
    expect(row).toMatchObject({ expenseCategory: "نظافة", expenseDesc: "مناديل", collectionDesc: "حجز مباشر", collectionCurrency: "USD", collectionMethod: "كاش" });
    expect(Number(row.expenseAmt)).toBe(50);
    expect(Number(row.collectionAmt)).toBe(300);
    expect(Number(rec.cafeteria.collectionAmt)).toBe(20);

    // العهدة: ١٠٠٠ جنيه
    const egpCard = block(page, "جنيه (EGP)");
    await egpCard.locator('input[type="number"]').first().fill("1000");
    await waitSaved(page);
    rec = await ledger(env);
    expect(rec.handover.EGP).toBe(1000);

    // الأرصدة المعروضة: EGP = ١٠٠٠ + ٢٠ - ٥٠ = ٩٧٠ ، USD = ٣٠٠
    expect(digits(await egpCard.innerText())).toMatch(/رصيدالخزينة970/);
    const usdCard = block(page, "دولار (USD)");
    expect(digits(await usdCard.innerText())).toMatch(/رصيدالخزينة300/);

    // ملاحظة + علامة متابعة
    await page.getByRole("checkbox").first().check();
    await page.getByPlaceholder("ملاحظات الشيفت").fill("العد ناقص ١٠ جنيه");
    await waitSaved(page);
    expect(await ledger(env)).toMatchObject({ flagged: true, shift_notes: "العد ناقص ١٠ جنيه" });

    // قفل الشيفت: بيحفظ الإجماليات وكل الحقول بتتقفل
    await page.getByRole("button", { name: /إقفال الشيفت/ }).click();
    await expect(page.getByText(/أُقفل بواسطة/)).toBeVisible();
    rec = await ledger(env);
    expect(rec).toMatchObject({ closed: true, closed_by: "أحمد" });
    expect(rec.closing_cash).toEqual({ EGP: 970, USD: 300 });
    expect(rec.total_expenses).toEqual({ EGP: 50 });
    expect(rec.total_collections).toEqual({ EGP: 20, USD: 300 });
    expect(rec.cash_collections).toEqual({ EGP: 20, USD: 300 });
    expect(rec.by_category).toEqual({ "نظافة": { EGP: 50 } });
    await expect(roomRow(page, 601).locator("input").first()).toBeDisabled();
    await expect(page.getByRole("button", { name: /إقفال الشيفت/ })).toHaveCount(0);

    // لوحة الغرف: التحصيل والمتابعة
    await goTab(page, "لوحة الغرف");
    await refresh(page);
    const kpi = digits(await page.locator(".cx-kpi", { hasText: "تحصيل اليوم" }).innerText());
    expect(kpi).toMatch(/300USD\+20EGP|20EGP\+300USD/);
    expect(digits(await page.locator(".cx-kpi", { hasText: "شيفتات تحتاج متابعة" }).innerText())).toContain("1");
    expect(digits(await page.locator(".cx-kpi", { hasText: "مصاريف اليوم" }).innerText())).toContain("50EGP");
    await logout(page);

    // مدير الحجوزات: التقرير بيعرض نفس الأرقام + ملاحظة المتابعة، وبعدين يفتح الشيفت
    await login(page, "rawan");
    await goTab(page, "التقارير");
    const grid = digits(await page.locator(".cx-report-grid").first().innerText());
    expect(grid).toContain("300$");
    expect(grid).toContain("20ج");
    expect(grid).toContain("50ج");
    await expect(page.getByText(/العد ناقص ١٠ جنيه/)).toBeVisible();
    expect(digits(await page.locator("table.cx-table tr", { hasText: "نظافة" }).first().innerText())).toContain("50");
    await goTab(page, "اليومية");
    await page.locator('input[type="date"]').fill(shiftDay());
    await page.getByRole("button", { name: SHIFT_LABEL[myShiftKey()] }).click();
    await expect(page.getByText(/مقفول بواسطة/)).toBeVisible();
    await page.getByRole("button", { name: /إعادة فتح الشيفت/ }).click();
    await expect(toast(page)).toContainText("تم إعادة فتح الشيفت");
    expect(await ledger(env)).toMatchObject({ closed: false });
    await logout(page);

    // الموظف يكمّل تاني بعد إعادة الفتح، وبيقفل من جديد بالأرقام الجديدة
    await login(page, "ahmed");
    await goTab(page, "اليومية");
    await roomRow(page, 602).getByPlaceholder("المبلغ").nth(0).fill("10");
    await waitSaved(page);
    await page.getByRole("button", { name: /إقفال الشيفت/ }).click();
    await expect(page.getByText(/أُقفل بواسطة/)).toBeVisible();
    rec = await ledger(env);
    expect(rec.closing_cash).toEqual({ EGP: 960, USD: 300 });
    expect(rec.total_expenses).toEqual({ EGP: 60 });
  });

  test("عهدة وسيلة دفع تانية (فيزا): بتتتبّع مع التحصيل بنفس الوسيلة والعملة", async ({ page, env }) => {
    await users(env);
    await page.goto("/");
    await login(page, "ahmed");
    await claimShift(page);
    await page.getByRole("button", { name: /متابعة عهدة/ }).click();            // فيزا / EGP (الافتراضي)
    await block(page, "فيزا (EGP)").locator('input[type="number"]').first().fill("500");
    const r603 = roomRow(page, 603);
    await r603.locator("select.cx-select").nth(2).selectOption("فيزا");
    await r603.getByPlaceholder("المبلغ").nth(1).fill("120");
    await waitSaved(page);
    const rec = await ledger(env);
    expect(rec.method_handover).toEqual({ "فيزا": { EGP: 500 } });
    expect(digits(await block(page, "فيزا (EGP)").innerText())).toContain("الإجماليدلوقتي620");
    await page.getByRole("button", { name: /إقفال الشيفت/ }).click();
    await expect(page.getByText(/أُقفل بواسطة/)).toBeVisible();
    expect((await ledger(env)).method_closing).toEqual({ "فيزا": { EGP: 620 } });
    expect((await ledger(env)).by_method_currency).toEqual({ "فيزا": { EGP: 120 } });
  });
});
