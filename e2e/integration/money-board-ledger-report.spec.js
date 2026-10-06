import { test, expect } from "../fixtures";
import { login, logout, claimShift, addBooking, goTab, boardTile, roomCard, toast, refresh, digits, shiftDay, myShiftKey, cairoDate } from "../ui";

async function seed(env) {
  await env.seedUser("boss", "gm", "المدير");
  await env.seedUser("ahmed", "staff", "أحمد");
  await env.seedUser("rawan", "reservations", "روان");
  await env.seedUser("mona", "accounts", "منى");
}

test("تحصيل كامل من لوحة الغرف: الحجز + اليومية + اللوحة + التقرير بنفس الرقم", async ({ page, env }) => {
  await seed(env);
  await page.goto("/");
  await login(page, "ahmed");
  await claimShift(page);
  await addBooking(page, { room: 601, guest: "Guest One", price: 100, nights: 2 });

  let [b] = await env.q("select * from bookings");
  expect(b).toMatchObject({ room: 601, guest_name: "Guest One", total_room: 200, amount_paid: 0, settled: false, created_by: "ahmed" });

  // لوحة الغرف: الغرفة حمراء (متبقي فلوس)
  await goTab(page, "لوحة الغرف");
  await expect(page.getByText(/مشغولة - متبقي فلوس 1/)).toBeVisible();
  await boardTile(page, 601).click();
  const card = roomCard(page);
  await expect(card).toContainText("Guest One");
  await card.getByTestId("collect-method").selectOption("فيزا");
  await card.getByRole("button", { name: /تسجيل تحصيل كامل المبلغ/ }).click();
  await expect(toast(page)).toContainText("تم تسجيل التحصيل الكامل");

  // قاعدة البيانات
  [b] = await env.q("select * from bookings");
  expect(b).toMatchObject({ amount_paid: 200, settled: true, payment_method: "فيزا" });
  const [rec] = await env.q("select * from shift_records");
  const row = rec.rows.find((r) => r.room === 601 && Number(r.collectionAmt) !== 0);
  expect(row).toMatchObject({ collectionAmt: 200, collectionMethod: "فيزا", collectionCurrency: "USD" });
  expect(rec.booking_collections).toHaveLength(1);
  expect(rec.booking_collections[0].bookingId).toBe(b.id);

  // اللوحة: الغرفة بقت متحصّلة، والـ KPI بيعرض التحصيل
  await expect(page.getByText(/مشغولة - متحصّلة 1/)).toBeVisible();
  await expect(page.getByText(/مشغولة - متبقي فلوس 0/)).toBeVisible();
  await refresh(page);
  await expect(page.locator(".cx-kpi", { hasText: "تحصيل اليوم" })).toContainText(/200\s*USD|٢٠٠\s*USD/);

  // اليومية: صف الغرفة 601 فيه ٢٠٠ فيزا دولار
  await goTab(page, "اليومية");
  const ledgerRow = page.locator("table.cx-table tbody tr", { hasText: "601" }).first();
  await expect(ledgerRow.locator('input[type="number"]').nth(1)).toHaveValue("200");
  await expect(ledgerRow.locator("select.cx-select").nth(2)).toHaveValue("فيزا");

  // مدير الحجوزات يشوف التقرير: إجمالي التحصيل ٢٠٠ دولار وفيزا ٢٠٠ دولار
  await logout(page);
  await login(page, "rawan");
  await goTab(page, "التقارير");
  await expect(page.locator(".cx-report-grid .cx-card", { hasText: "إجمالي التحصيل" }).first()).toContainText("200$", { useInnerText: true }).catch(async () => {
    expect(digits(await page.locator(".cx-report-grid .cx-card", { hasText: "إجمالي التحصيل" }).first().innerText())).toContain("200$");
  });
  const visaRow = page.locator("table.cx-table tr", { hasText: "فيزا" }).first();
  expect(digits(await visaRow.innerText())).toContain("200");
});
