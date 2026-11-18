import { describe, it, expect } from "vitest";
import { payLineApiRate, payLineCovered, payLineRateLabel } from "../domain/payLines";

describe("سعر الصرف في سطور الدفع: دايمًا 1 دولار = كام جنيه", () => {
  it("حجز بالجنيه ودفعة بالدولار: 3 دولار بسعر 50 = 150 جنيه", () => {
    const l = { amount: "3", currency: "USD", rate: "50" };
    expect(payLineCovered(l, "EGP")).toBe(150);
    expect(payLineApiRate(l, "EGP")).toBeCloseTo(0.02);
    expect(payLineRateLabel(l, "EGP")).toBe("1 USD = كام EGP");
  });
  it("حجز بالدولار ودفعة بالجنيه: 1600 جنيه بسعر 50 = 32 دولار", () => {
    const l = { amount: "1600", currency: "EGP", rate: "50" };
    expect(payLineCovered(l, "USD")).toBe(32);
    expect(payLineApiRate(l, "USD")).toBe(50);
    expect(payLineRateLabel(l, "USD")).toBe("1 USD = كام EGP");
  });
  it("من غير سعر = صفر", () => {
    expect(payLineCovered({ amount: "10", currency: "USD", rate: "" }, "EGP")).toBe(0);
  });
});
