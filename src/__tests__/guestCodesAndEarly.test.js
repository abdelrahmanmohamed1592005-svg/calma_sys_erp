import { describe, it, expect } from "vitest";
import { normalizeGuestCodes, guestCodeEntries, duplicateGuestCode, findGuestCodeHits, earlyLeavePatch, repricedTotalRoom, computeRoomStatus } from "../domain/bookingLogic";
import { bookingHotelTotal, bookingAmountDue, bookingGrandTotal, refundDueAmount } from "../domain/money";

const base = { id: "b1", room: 601, guestName: "A", pax: 3, checkin: "2030-01-01", checkout: "2030-01-04", priceNight: 100, currency: "USD", totalRoom: 300, extras: {}, earlyCheckin: { applied: false, fee: 0, note: "" }, paymentDetails: {}, amountPaid: 0, status: "مؤكد", settled: false };

describe("أكواد الأفراد اللي المستخدم بيكتبها", () => {
  it("normalizeGuestCodes بتظبط الطول على عدد الأفراد وتقصّ المسافات والطول", () => {
    expect(normalizeGuestCodes(["a ", "b"], 3)).toEqual(["a", "b", ""]);
    expect(normalizeGuestCodes(["a", "b", "c", "d"], 2)).toEqual(["a", "b"]);
    expect(normalizeGuestCodes(undefined, 0)).toEqual([""]);
    expect(normalizeGuestCodes(["x".repeat(60)], 1)[0]).toHaveLength(40);
  });
  it("guestCodeEntries بترجّع الأفراد اللي ليهم كود بس وبترقيمهم الصح", () => {
    expect(guestCodeEntries({ pax: 3, guestCodes: ["", "B", "C"] })).toEqual([{ seq: 2, code: "B" }, { seq: 3, code: "C" }]);
    expect(guestCodeEntries({ pax: 1, guestCodes: ["A", "ignored"] })).toEqual([{ seq: 1, code: "A" }]);
    expect(guestCodeEntries({ pax: 2 })).toEqual([]);
  });
  it("duplicateGuestCode بتكتشف التكرار جوه الحجز من غير حساسية لحالة الحروف وتتجاهل الفاضي", () => {
    expect(duplicateGuestCode(["a", "", "", "A"])).toBe("A");
    expect(duplicateGuestCode(["a", "b", "", ""])).toBeNull();
  });
  it("findGuestCodeHits بتطلّع كل حجز فيه الكود (نزيل راجع) والأحدث أول", () => {
    const bs = [
      { ...base, id: "1", room: 601, checkin: "2030-01-01", pax: 1, guestCodes: ["Zed"] },
      { ...base, id: "2", room: 605, checkin: "2030-03-01", pax: 2, guestCodes: ["x", "ZED"] },
      { ...base, id: "3", room: 606, pax: 1, guestCodes: ["other"] },
    ];
    const hits = findGuestCodeHits(bs, " zed ");
    expect(hits.map((h) => [h.room, h.seq])).toEqual([[605, 2], [601, 1]]);
    expect(findGuestCodeHits(bs, "")).toEqual([]);
    expect(findGuestCodeHits(bs, "ze")).toEqual([]);            // مطابقة كاملة بس
  });
});

describe("المستحق على الفندق (عادي وأونلاين)", () => {
  const early = { applied: true, fee: 50, note: "" };
  it("حجز عادي: الإجمالي الكلي بما فيه الدخول المبكر", () => {
    const b = { ...base, earlyCheckin: early, amountPaid: 300 };
    expect(bookingHotelTotal(b)).toBe(350);
    expect(bookingAmountDue(b)).toBe(50);
  });
  it("حجز أونلاين: سعر الغرفة مش مطلوب من الفندق، المطلوب الخدمات والدخول المبكر بس", () => {
    const b = { ...base, paymentDetails: { onlinePaid: true }, earlyCheckin: early, extras: { tours: 30 } };
    expect(bookingHotelTotal(b)).toBe(80);
    expect(bookingAmountDue(b)).toBe(80);
    expect(bookingAmountDue({ ...b, amountPaid: 80 })).toBe(0);
    expect(bookingAmountDue({ ...base, paymentDetails: { onlinePaid: true } })).toBe(0);
  });
  it("لوحة الغرف: الأونلاين اللي عليه خدمات لسه ماتحصّلتش بيبان 'متبقي فلوس'", () => {
    const b = { ...base, checkin: "2030-01-01", checkout: "2030-01-04", paymentDetails: { onlinePaid: true }, extras: { laundry: 20 } };
    expect(computeRoomStatus(601, [b], {}, "2030-01-02").key).toBe("occupied_unpaid");
    expect(computeRoomStatus(601, [{ ...b, amountPaid: 20 }], {}, "2030-01-02").key).toBe("occupied_paid");
    expect(computeRoomStatus(601, [{ ...b, extras: {} }], {}, "2030-01-02").key).toBe("occupied_paid");
  });
});

describe("المغادرة المبكرة", () => {
  it("قعد ليلة من ٣ ودافع الكل: بيتحاسب ليلة والباقي يتحوّل لرد", () => {
    const b = { ...base, amountPaid: 300, settled: true };
    const patch = earlyLeavePatch(b, "2030-01-02", "plain");
    expect(patch).toMatchObject({ checkout: "2030-01-02", totalRoom: 100, leftEarly: true, status: "تم تسجيل الخروج", settled: true });
    expect(patch.notes).toContain("قبل معاده 2030-01-04");
    expect(patch.notes).not.toContain("تسكين مكرر");
    const after = { ...b, ...patch, refundPending: true };
    expect(refundDueAmount(after)).toBe(200);
  });
  it("مشي نفس يوم الدخول: الحد الأدنى ليلة (مش صفر)", () => {
    const patch = earlyLeavePatch({ ...base, amountPaid: 200, checkout: "2030-01-03", totalRoom: 200 }, "2030-01-01", "plain");
    expect(patch).toMatchObject({ checkout: "2030-01-01", totalRoom: 100, leftEarly: true });
  });
  it("المدفوع أقل من الليالي اللي قعدها: علامة متحصّل بتتشال", () => {
    const patch = earlyLeavePatch({ ...base, amountPaid: 100, settled: true }, "2030-01-03", "plain");
    expect(patch.settled).toBe(false);
    expect(bookingGrandTotal({ ...base, totalRoom: patch.totalRoom })).toBe(200);
  });
  it("تسكين مكرر: الملاحظة بتذكر التسكين", () => {
    expect(earlyLeavePatch(base, "2030-01-02").notes).toContain("تسكين مكرر");
  });
  it("repricedTotalRoom ثابت مع نفس عدد الليالي", () => {
    expect(repricedTotalRoom(base, base.checkin, base.checkout)).toBe(300);
  });
});
