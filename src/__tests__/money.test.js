import { describe, it, expect } from "vitest";
import { computeShiftTotals, bookingGrandTotal, emptyLedgerRow, freshShiftRecord, onlineNetAmount, emptyPaymentDetails, DEFAULT_ONLINE_COMMISSION_PCT } from "../domain/money";

describe("computeShiftTotals", () => {
  it("separates EGP and USD totals correctly", () => {
    const rooms = [{ number: 601 }, { number: 602 }];
    const record = freshShiftRecord("2026-09-05", "morning", "Ahmed", "ahmed", rooms, { EGP: 500, USD: 0 });
    record.rows[0] = { ...record.rows[0], collectionAmt: "1000", collectionCurrency: "EGP", collectionMethod: "كاش" };
    record.rows[1] = { ...record.rows[1], collectionAmt: "50", collectionCurrency: "USD", collectionMethod: "كاش" };

    const totals = computeShiftTotals(record);
    expect(totals.totalCollections.EGP).toBe(1000);
    expect(totals.totalCollections.USD).toBe(50);
    expect(totals.cashCollections.EGP).toBe(1000);
    expect(totals.closingCash.EGP).toBe(1500); // 500 handover + 1000 cash
    expect(totals.closingCash.USD).toBe(50);
  });

  it("excludes non-cash collections from the cash drawer balance", () => {
    const rooms = [{ number: 601 }];
    const record = freshShiftRecord("2026-09-05", "morning", "Ahmed", "ahmed", rooms, { EGP: 0, USD: 0 });
    record.rows[0] = { ...record.rows[0], collectionAmt: "2000", collectionCurrency: "EGP", collectionMethod: "فيزا" };

    const totals = computeShiftTotals(record);
    expect(totals.totalCollections.EGP).toBe(2000);
    expect(totals.cashCollections.EGP || 0).toBe(0); // مفيش تحصيل كاش خالص، فمفتاح EGP مش هيتسجل أصلاً (سلوك ديناميكي مقصود)
    expect(totals.closingCash.EGP).toBe(0); // مفيش نقدية فعلية دخلت الدرج
  });

  it("subtracts expenses from the closing cash balance", () => {
    const rooms = [{ number: 601 }];
    const record = freshShiftRecord("2026-09-05", "morning", "Ahmed", "ahmed", rooms, { EGP: 1000, USD: 0 });
    record.rows[0] = { ...record.rows[0], expenseAmt: "300", expenseCurrency: "EGP" };

    const totals = computeShiftTotals(record);
    expect(totals.totalExpenses.EGP).toBe(300);
    expect(totals.closingCash.EGP).toBe(700);
  });

  it("groups expenses by category", () => {
    const rooms = [{ number: 601 }, { number: 602 }];
    const record = freshShiftRecord("2026-09-05", "morning", "Ahmed", "ahmed", rooms, { EGP: 0, USD: 0 });
    record.rows[0] = { ...record.rows[0], expenseAmt: "100", expenseCurrency: "EGP", expenseCategory: "صيانة" };
    record.rows[1] = { ...record.rows[1], expenseAmt: "200", expenseCurrency: "EGP", expenseCategory: "صيانة" };

    const totals = computeShiftTotals(record);
    expect(totals.byCategory["صيانة"].EGP).toBe(300);
  });
});

describe("bookingGrandTotal", () => {
  it("sums room total with all extras", () => {
    const booking = { totalRoom: 200, extras: { laundry: 10, cafeteria: 20, tours: 30, pickup: 15 } };
    expect(bookingGrandTotal(booking)).toBe(275);
  });

  it("includes the early check-in fee only when applied", () => {
    const applied = { totalRoom: 100, extras: {}, earlyCheckin: { applied: true, fee: 25 } };
    const notApplied = { totalRoom: 100, extras: {}, earlyCheckin: { applied: false, fee: 25 } };
    expect(bookingGrandTotal(applied)).toBe(125);
    expect(bookingGrandTotal(notApplied)).toBe(100);
  });

  it("handles a booking with no extras object at all", () => {
    expect(bookingGrandTotal({ totalRoom: 50 })).toBe(50);
  });
});

describe("computeShiftTotals - عملات غير EGP/USD (كانت باگ قبل كده)", () => {
  it("tracks a currency like EUR correctly end-to-end, not just EGP/USD", () => {
    const rooms = [{ number: 601 }];
    const record = freshShiftRecord("2026-09-05", "morning", "Ahmed", "ahmed", rooms, { EUR: 100 });
    record.rows[0] = { ...record.rows[0], collectionAmt: "40", collectionCurrency: "EUR", collectionMethod: "كاش" };
    const totals = computeShiftTotals(record);
    expect(totals.totalCollections.EUR).toBe(40);
    expect(totals.cashCollections.EUR).toBe(40);
    expect(totals.closingCash.EUR).toBe(140); // 100 عهدة + 40 كاش
    // ومفيش حاجة اتسجلت غلط في EGP/USD من غير داعي
    expect(totals.closingCash.EGP).toBeUndefined();
    expect(totals.closingCash.USD).toBeUndefined();
  });
});

describe("onlineNetAmount (حجوزات أونلاين - السعر بالعمولة)", () => {
  it("subtracts the commission percentage from the gross amount", () => {
    expect(onlineNetAmount(1000, 15)).toBe(850);
  });
  it("returns the full amount when commission is 0", () => {
    expect(onlineNetAmount(1000, 0)).toBe(1000);
  });
  it("treats a missing/undefined commission as 0", () => {
    expect(onlineNetAmount(1000, undefined)).toBe(1000);
  });
  it("treats a missing/undefined gross amount as 0", () => {
    expect(onlineNetAmount(undefined, 15)).toBe(0);
  });
  it("handles a 100% commission (net is zero)", () => {
    expect(onlineNetAmount(500, 100)).toBe(0);
  });
});

describe("emptyPaymentDetails online fields", () => {
  it("defaults onlinePaid to false and commissionPct to the standard default", () => {
    const pd = emptyPaymentDetails();
    expect(pd.onlinePaid).toBe(false);
    expect(pd.commissionPct).toBe(DEFAULT_ONLINE_COMMISSION_PCT);
  });
});
