/* إمكانية الوصول (WCAG 2 A/AA عبر axe-core) على الشاشات الحرجة: تسجيل الدخول، لوحة الغرف، بطاقة الغرفة، اليومية، الحجوزات.
   ملحوظة: axe بيكشف جزء من المشاكل بس (تسميات الحقول، التباين، أسماء الأزرار) - مش بديل لتجربة قارئ شاشة حقيقي. */
import fs from "node:fs";
import { createRequire } from "node:module";
import { test, expect } from "../fixtures";
import { login, goTab, openRoom } from "../ui";

const AXE = fs.readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
const scan = async (page) => {
  await page.evaluate(AXE);
  return page.evaluate(async () => (await window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa"] })).violations.map((v) => `${v.id} x${v.nodes.length}: ${v.nodes[0].html.slice(0, 120)}`));
};

test("لا مخالفات WCAG A/AA في الشاشات الحرجة، والصفحة RTL بالعربي", async ({ page, env }) => {
  await env.seedUser("ahmed", "staff", "أحمد");
  await env.seedBooking({ room: 601, guest: "A11y Guest", nights: 2, price: 100, paid: 50 });
  await env.seedShift("ahmed");
  await page.goto("/");
  expect(await page.evaluate(() => [document.documentElement.dir, document.documentElement.lang])).toEqual(["rtl", "ar"]);
  expect(await scan(page), "login").toEqual([]);
  await login(page, "ahmed");
  await goTab(page, "لوحة الغرف"); expect(await scan(page), "board").toEqual([]);
  await openRoom(page, 601); expect(await scan(page), "room card").toEqual([]);
  await goTab(page, "اليومية"); expect(await scan(page), "ledger").toEqual([]);
  await goTab(page, "الحجوزات"); expect(await scan(page), "bookings").toEqual([]);
});

test("حالة 'مش في شيفتك' (رسائل التنبيه بالأحمر على خلفية فاتحة) كمان من غير مخالفات", async ({ page, env }) => {
  await env.seedUser("ahmed", "staff", "أحمد");
  await env.seedBooking({ room: 601, guest: "A11y Guest", nights: 2, price: 100, paid: 50 });       // من غير شيفت للموظف
  await page.goto("/");
  await login(page, "ahmed");
  await goTab(page, "الحجوزات"); expect(await scan(page), "bookings off-shift").toEqual([]);
  await goTab(page, "لوحة الغرف"); await openRoom(page, 601); expect(await scan(page), "room card off-shift").toEqual([]);
});
