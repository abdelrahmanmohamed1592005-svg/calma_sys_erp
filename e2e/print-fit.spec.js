import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

/* الطباعة: البيان الطويل جوه حقل <input> لازم يبان كامل (يلفّ على أكتر من سطر) مش يتقصّ - لكل جداول اليومية/الحجوزات/التقارير. */
const lib = readFileSync(new URL("../src/lib/printFit.js", import.meta.url), "utf8").replace(/export /g, "");
const LONG = "تحصيل حجز جديد - (OGP 0) اسم نزيل طويل جدًا جدًا جدًا جدًا جدًا جدًا جدًا جدًا جدًا جدًا يوضح التقطيع";

test("حقل نصي طويل بيتحوّل وقت الطباعة لنص كامل بيلفّ، وبيرجع بعد الطباعة", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.setContent(`<html><body dir="rtl"><style>${lib.match(/PRINT_FIT_CSS = `([\s\S]*?)`;/)[1]}
    table{width:100%;border-collapse:collapse} td{border:1px solid #999;width:140px} input{width:100%;box-sizing:border-box}</style>
    <table><tr><td><input id="a" class="cx-input" value="${LONG}"></td><td><input id="n" type="number" value="150"></td></tr></table></body></html>`);
  await page.addScriptTag({ content: `${lib}; window.__pf = { expandForPrint, restoreAfterPrint, installPrintFit }; installPrintFit();` });
  await page.emulateMedia({ media: "print" });
  await page.evaluate(() => window.dispatchEvent(new Event("beforeprint")));

  const clone = page.locator(".cx-print-value");
  await expect(clone).toHaveCount(1); // النصي بس، مش حقل الرقم
  await expect(clone).toHaveText(LONG);
  await expect(page.locator("#a")).toBeHidden();
  const m = await clone.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth, h: el.getBoundingClientRect().height, lh: parseFloat(getComputedStyle(el).lineHeight) }));
  expect(m.sw).toBeLessThanOrEqual(m.cw + 1); // مفيش قص أفقي
  expect(m.h).toBeGreaterThan(m.lh * 1.5); // لفّ على أكتر من سطر

  await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
  await expect(page.locator(".cx-print-value")).toHaveCount(0);
  await expect(page.locator("#a")).toBeVisible();
});
