import { describe, it, expect } from "vitest";
import { descWithAmount } from "../domain/ledgerDesc";

describe("بيان صف اليومية بعد تعديل المبلغ", () => {
  it("المبلغ اللي جوه البيان بيتغيّر للجديد", () => {
    expect(descWithAmount("تحصيل حجز جديد - سمير (+4000 EGP)", 4000, 3000, "EGP")).toBe("تحصيل حجز جديد - سمير (+3000 EGP)");
  });
  it("بيان متجمّع (أكتر من مبلغ) بيتكتب في آخره المبلغ الجديد، ومن غير تكرار لو اتعدّل تاني", () => {
    const d = "تحصيل - أ (+100 EGP) / تحصيل - ب (+200 EGP)";
    const once = descWithAmount(d, 300, 250, "EGP");
    expect(once).toBe(d + " ← اتعدّل لـ 250 EGP");
    expect(descWithAmount(once, 250, 200, "EGP")).toBe(d + " ← اتعدّل لـ 200 EGP");
    expect(descWithAmount(once, 250, 300, "EGP")).toBe(d + " ← اتعدّل لـ 300 EGP");
  });
  it("بيان بعملة تانية أو من غير مبلغ", () => {
    expect(descWithAmount("KHARROUB (+30 USD)", 1600, 1500, "EGP")).toBe("KHARROUB (+30 USD) ← اتعدّل لـ 1500 EGP");
    expect(descWithAmount("", 0, 500, "EGP")).toBe("← اتعدّل لـ 500 EGP");
  });
});
