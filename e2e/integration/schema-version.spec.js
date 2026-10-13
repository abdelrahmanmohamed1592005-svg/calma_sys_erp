/*
  قاعدة بيانات لسه ماتحدّثتش (ما اتشغّلش schema.sql الجديد): الواجهة لازم تقول ده بوضوح بدل "Could not find the function ... in the schema cache".
*/
import { test, expect } from "../fixtures";
import { login, goTab, toast, openRoom, payOnBoard, waitIdle } from "../ui";

async function users(env) {
  await env.seedUser("boss", "gm", "المدير");
  await env.seedUser("ahmed", "staff", "أحمد");
}
const missing = (name) => ({ status: 404, headers: { "access-control-allow-origin": "*", "content-type": "application/json" }, body: JSON.stringify({ code: "PGRST202", details: null, hint: null, message: `Could not find the function public.${name}() in the schema cache` }) });

test("القاعدة على آخر نسخة: مفيش بانر تحذير", async ({ page, env }) => {
  await users(env);
  await page.goto("/"); await login(page, "boss");
  await goTab(page, "لوحة الغرف");
  await page.waitForTimeout(800);
  await expect(page.getByTestId("schema-outdated-banner")).toHaveCount(0);
});

test("القاعدة قديمة (الدوال الجديدة مش موجودة): بانر واضح، والدفع بيقول المطلوب بدل رسالة تقنية، ومفيش فلوس بتتسجّل", async ({ page, env }) => {
  await users(env);
  const id = await env.seedBooking({ room: 601, guest: "Old Schema", nights: 1, price: 100 });
  await env.seedShift("ahmed");
  await page.route(/fake-supabase\.test\/rest\/v1\/rpc\/calma_schema_version/, (r) => r.fulfill(missing("calma_schema_version")));
  await page.route(/fake-supabase\.test\/rest\/v1\/rpc\/record_booking_payment/, (r) => r.fulfill(missing("record_booking_payment")));
  await page.goto("/"); await login(page, "ahmed");
  await expect(page.getByTestId("schema-outdated-banner")).toBeVisible();
  await expect(page.getByTestId("schema-outdated-banner")).toContainText("بلّغ المدير العام");
  await goTab(page, "لوحة الغرف"); await openRoom(page, 601);
  await payOnBoard(page);
  await expect(toast(page)).toContainText("schema.sql");
  await expect(toast(page)).not.toContainText("Could not find the function");
  const [b] = await env.q("select amount_paid::float p from bookings where id = $1", [id]);
  expect(b.p).toBe(0);
});

test("المدير العام بيشوف في البانر الخطوة المطلوبة (تشغيل schema.sql)", async ({ page, env }) => {
  await users(env);
  await page.route(/fake-supabase\.test\/rest\/v1\/rpc\/calma_schema_version/, (r) => r.fulfill(missing("calma_schema_version")));
  await page.goto("/"); await login(page, "boss");
  await expect(page.getByTestId("schema-outdated-banner")).toContainText("schema.sql");
});
