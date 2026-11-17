// سجل أخطاء السيستم: خطأ غير متوقع عند موظف بيتسجّل لوحده، والمدير العام بيشوفه في سجل الحركة، والموظف مايقراش السجل.
import { test, expect } from "../fixtures";
import { login, goTab, logout } from "../ui";

test("خطأ غير متوقع في متصفح الموظف بيتسجّل، والمدير العام بيشوفه في سجل الحركة", async ({ page, env }) => {
  await env.seedUser("boss", "gm", "المدير");
  await env.seedUser("ahmed", "staff", "أحمد");
  await page.goto("/");
  await login(page, "ahmed");
  await page.evaluate(() => { setTimeout(() => { throw new Error("boom-e2e-test"); }, 0); });
  await expect.poll(async () => (await env.q("select username, kind, message from client_errors")).map((r) => `${r.username}|${r.kind}|${r.message}`), { timeout: 10_000 })
    .toContain("ahmed|js|Uncaught Error: boom-e2e-test");
  // رسايل قواعد السيستم العادية (P0001) مش أخطاء ومابتتسجّلش
  const before = (await env.q("select count(*)::int n from client_errors"))[0].n;
  await env.api("ahmed", "POST", "/rest/v1/rpc/record_booking_payment", { p_booking: "00000000-0000-0000-0000-000000000000", p_amount: 5, p_method: "كاش", p_details: {}, p_note: "", p_expected: null });
  expect((await env.q("select count(*)::int n from client_errors"))[0].n).toBe(before);
  // الموظف مايقدرش يقرا سجل الأخطاء
  const r = await env.api("ahmed", "GET", "/rest/v1/client_errors?select=id");
  expect(Array.isArray(r.body) ? r.body.length : 0).toBe(0);
  await logout(page);
  await login(page, "boss");
  await goTab(page, "سجل الحركة");
  const box = page.getByTestId("system-errors");
  await expect(box).toContainText("1 في آخر ٢٤ ساعة");
  await box.locator("summary").first().click();
  await expect(box.getByTestId("system-error-row").first()).toContainText("boom-e2e-test");
});
