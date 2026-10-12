import { describe, it, expect } from "vitest";
import {
  normalizeLast4, normalizePhone, cleanPaymentDetailsFor, validatePaymentDetailsFor, describePaymentDetails, sameDetails,
  applyCollectionToRows, applyCafeteriaCollection, splitPaymentForCafeteria, cafeteriaOutstanding, methodTransactions,
  computeShiftTotals, freshShiftRecord, emptyLedgerRow,
} from "../domain/money";

describe("تفاصيل الدفع حسب الوسيلة", () => {
  it("الفيزا: آخر ٤ أرقام بس (حتى لو لصق رقم الكارت كامل أو بأرقام عربي)", () => {
    expect(normalizeLast4("4111 1111 1111 1234")).toBe("1234");
    expect(normalizeLast4("١٢٣٤")).toBe("1234");
    expect(cleanPaymentDetailsFor("فيزا", { senderName: "أحمد", senderNumber: "4111111111111234", ref: "R1" })).toEqual({ senderName: "", senderNumber: "1234", ref: "", onlinePaid: false });
  });
  it("التحويل/فودافون: اسم + رقم تليفون، من غير رقم عملية", () => {
    expect(cleanPaymentDetailsFor("فودافون كاش", { senderName: " سارة ", senderNumber: "010 1234-5678", ref: "X" })).toEqual({ senderName: "سارة", senderNumber: "01012345678", ref: "", onlinePaid: false });
    expect(cleanPaymentDetailsFor("كاش", { senderName: "x", senderNumber: "1" })).toEqual({ senderName: "", senderNumber: "", ref: "", onlinePaid: false });
  });
  it("التحقق: الفيزا لازم ٤ أرقام، والتحويل لازم رقم", () => {
    expect(validatePaymentDetailsFor("فيزا", { senderNumber: "12" })).not.toBe("");
    expect(validatePaymentDetailsFor("فيزا", { senderNumber: "1234" })).toBe("");
    expect(validatePaymentDetailsFor("تحويل بنكي / انستاباي", { senderName: "x", senderNumber: "" })).not.toBe("");
    expect(validatePaymentDetailsFor("تحويل بنكي / انستاباي", { senderNumber: "01012345678" })).toBe("");
    expect(validatePaymentDetailsFor("كاش", {})).toBe("");
  });
  it("وصف التفاصيل: ****1234 أو اسم · رقم", () => {
    expect(describePaymentDetails("فيزا", { senderNumber: "1234" })).toBe("****1234");
    expect(describePaymentDetails("فودافون كاش", { senderName: "سارة", senderNumber: "0101" })).toBe("سارة · 0101");
    expect(describePaymentDetails("كاش", { senderNumber: "1" })).toBe("");
  });
  it("كارتين مختلفين مش نفس التفاصيل", () => {
    expect(sameDetails("فيزا", { senderNumber: "1111" }, { senderNumber: "2222" })).toBe(false);
    expect(sameDetails("كاش", { senderNumber: "1111" }, { senderNumber: "2222" })).toBe(true);
  });
});

describe("تحصيل الحجز بيروح للوسيلة الصح بتفاصيلها", () => {
  const rows = [emptyLedgerRow(601), emptyLedgerRow(602)];
  const visa = { amount: 100, currency: "USD", method: "فيزا", room: 601, bookingId: "b1", guestName: "Ali", details: { senderNumber: "1234" } };
  it("دفعة فيزا: صف فيزا فيه آخر ٤ أرقام، مش كاش", () => {
    const { rows: out } = applyCollectionToRows(rows, visa);
    expect(out[0]).toMatchObject({ collectionMethod: "فيزا", collectionAmt: 100, bookingId: "b1" });
    expect(out[0].paymentDetails.senderNumber).toBe("1234");
    const t = computeShiftTotals({ ...freshShiftRecord("2030-01-01", "morning", "a", "a", [{ number: 601 }]), rows: out });
    expect(t.byMethodCurrency["فيزا"].USD).toBe(100);
    expect(t.cashCollections.USD).toBeUndefined();
    expect(t.methodClosing["فيزا"].USD).toBe(100);
  });
  it("كاش وفيزا لنفس الحجز: صفين منفصلين، مفيش خلط", () => {
    let r = applyCollectionToRows(rows, { ...visa, amount: 100 }).rows;
    r = applyCollectionToRows(r, { amount: 50, currency: "USD", method: "كاش", room: 601, bookingId: "b1", guestName: "Ali" }).rows;
    const mine = r.filter((x) => x.room === 601 && (Number(x.collectionAmt) || 0) !== 0);
    expect(mine.map((x) => [x.collectionMethod, x.collectionAmt])).toEqual([["فيزا", 100], ["كاش", 50]]);
  });
  it("نفس الكارت بيتجمّع، كارت تاني صف جديد", () => {
    let r = applyCollectionToRows(rows, visa).rows;
    r = applyCollectionToRows(r, { ...visa, amount: 20 }).rows;
    expect(r.filter((x) => x.room === 601 && x.collectionAmt).map((x) => x.collectionAmt)).toEqual([120]);
    r = applyCollectionToRows(r, { ...visa, amount: 30, details: { senderNumber: "9999" } }).rows;
    expect(r.filter((x) => x.room === 601 && x.collectionAmt).map((x) => [x.collectionAmt, x.paymentDetails.senderNumber])).toEqual([[120, "1234"], [30, "9999"]]);
  });
  it("methodTransactions بترجّع العمليات بتفاصيلها", () => {
    const { rows: out } = applyCollectionToRows(rows, visa);
    expect(methodTransactions({ rows: out, cafeteria: emptyLedgerRow("كافيتيريا") }, "فيزا")).toEqual([{ where: "غرفة 601", label: expect.any(String), amount: 100, currency: "USD", details: "****1234" }]);
  });
});

describe("كافيتيريا النزلاء والاستاف", () => {
  it("الدفعة بتسدّد الكافيتيريا الأول والباقي للغرفة", () => {
    const b = { extras: { cafeteria: 60, cafeteriaPaid: 10 } };
    expect(cafeteriaOutstanding(b)).toBe(50);
    expect(splitPaymentForCafeteria(b, 30)).toEqual({ cafeteria: 30, rest: 0 });
    expect(splitPaymentForCafeteria(b, 80)).toEqual({ cafeteria: 50, rest: 30 });
    expect(splitPaymentForCafeteria({ extras: {} }, 80)).toEqual({ cafeteria: 0, rest: 80 });
  });
  it("تحصيل كافيتيريا نزيل/استاف بيدخل إجمالي اليومية بوسيلته", () => {
    let c = applyCafeteriaCollection([], { kind: "guest", bookingId: "b1", room: 601, who: "Ali", amount: 50, currency: "EGP", method: "فيزا", details: { senderNumber: "1234" }, note: "خدمة كافيتيريا" }).rows;
    c = applyCafeteriaCollection(c, { kind: "staff", consumerKey: "mona", who: "منى", amount: 20, currency: "EGP", method: "كاش" }).rows;
    c = applyCafeteriaCollection(c, { kind: "staff", consumerKey: "mona", who: "منى", amount: 5, currency: "EGP", method: "كاش" }).rows;
    expect(c.length).toBe(2);
    const rec = { ...freshShiftRecord("2030-01-01", "morning", "a", "a", [{ number: 601 }]), cafeteriaRows: c };
    const t = computeShiftTotals(rec);
    expect(t.totalCollections.EGP).toBe(75);
    expect(t.byMethodCurrency["فيزا"].EGP).toBe(50);
    expect(t.cashCollections.EGP).toBe(25);
  });
});
