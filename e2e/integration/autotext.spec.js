// الحقول النصية الطويلة (بيان اليومية، اسم النزيل، الملاحظات) بتكبر لوحدها وتنزل لسطر تاني على الشاشة بدل ما تتقصّ.
import { test, expect } from "../fixtures";
import { login, goTab, claimShift, showAllRooms } from "../ui";

test("بيان التحصيل الطويل في اليومية بيكبر لوحده ومبيتقصّش، وEnter مابيعملش سطر جديد", async ({ page, env }) => {
  await env.seedUser("ahmed", "staff", "أحمد");
  await page.goto("/");
  await login(page, "ahmed");
  await claimShift(page); await showAllRooms(page);
  const box = page.locator('table.cx-table [data-autotext][placeholder="بيان التحصيل"]').first();
  const h0 = (await box.boundingBox()).height;
  const LONG = "تحصيل حجز جديد - بيان طويل جدًا جدًا جدًا يتكرر عشان يتخطى عرض الخانة كذا مرة ويظهر كله على أكتر من سطر ".repeat(2);
  await box.fill(LONG);
  const m = await box.evaluate((el) => ({ h: el.getBoundingClientRect().height, sh: el.scrollHeight, ch: el.clientHeight }));
  expect(m.h).toBeGreaterThan(h0 * 1.8);        // كبر
  expect(m.sh).toBeLessThanOrEqual(m.ch + 3);    // مفيش جزء مخفي
  await box.press("Enter");
  await expect(box).toHaveValue(LONG);           // مفيش سطر جديد
  await box.fill("قصير");
  expect((await box.boundingBox()).height).toBeLessThan(m.h);  // بيصغر تاني
});
