import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { repricedTotalRoom } from "../domain/bookingLogic";

// نفس الحالات بتتختبر في قاعدة البيانات (supabase/tests/summary.sql) على دالة
// reprice_total - عشان معادلة إعادة تسعير الإقامة في الواجهة وفي قاعدة
// البيانات (اللي بترفض أي تعديل مش مطابق ليها) متفرقوش أبدًا.
const cases = JSON.parse(readFileSync(new URL("../../supabase/tests/reprice_cases.json", import.meta.url), "utf8"));

describe("repricedTotalRoom (تطابق مع reprice_total في قاعدة البيانات)", () => {
  cases.forEach((c) => {
    it(`${c.checkin}→${c.checkout} إلى ${c.newCheckout} (إجمالي ${c.totalRoom}، سعر ${c.priceNight})`, () => {
      const original = { checkin: c.checkin, checkout: c.checkout, totalRoom: c.totalRoom, priceNight: c.priceNight };
      expect(repricedTotalRoom(original, c.checkin, c.newCheckout)).toBeCloseTo(c.expected, 2);
    });
  });
});
