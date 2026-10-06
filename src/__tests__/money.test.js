import { describe, it, expect } from "vitest";
import { computeShiftTotals, bookingGrandTotal, emptyLedgerRow, freshShiftRecord, emptyPaymentDetails, directBookingPaymentsByMethod, COMMON_CURRENCIES, PAYMENT_METHODS, ONLINE_METHODS, applyCollectionToRows, refundDueAmount, rebaseShiftRecord, refundStatusOf } from "../domain/money";

// انستاباي والتحويل البنكي وسيلة واحدة فعليًا - اتدمجوا في خيار واحد بدل
// خيارين مختلفين، وفضلت العملات المعتمدة خمسة بس.
describe("payment methods and currencies are fixed lists", () => {
  it("merges Instapay and bank transfer into a single payment method", () => {
    expect(PAYMENT_METHODS.filter((m) => m.includes("انستاباي") || m.includes("تحويل بنكي"))).toHaveLength(1);
    expect(PAYMENT_METHODS).not.toContain("انستاباي");
    expect(PAYMENT_METHODS).not.toContain("تحويل بنكي");
  });
  it("keeps the merged method in the online methods list", () => {
    expect(ONLINE_METHODS.some((m) => m.includes("انستاباي"))).toBe(true);
  });
  it("supports exactly five fixed currencies", () => {
    expect(COMMON_CURRENCIES).toEqual(["EGP", "USD", "EUR", "SAR", "GBP"]);
  });
});

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

describe("عهدة وسائل الدفع الأخرى (فيزا، إلخ) - methodHandover / methodClosing", () => {
  it("carries the opening Visa handover forward and adds this shift's Visa collections", () => {
    const rooms = [{ number: 601 }];
    // عهدة الفيزا في بداية الشيفت (قراءة الجهاز المنقولة من إقفال الشيفت اللي فات)
    const record = freshShiftRecord("2026-09-05", "morning", "Ahmed", "ahmed", rooms, { EGP: 0 }, { "فيزا": { EGP: 12000 } });
    record.rows[0] = { ...record.rows[0], collectionAmt: "800", collectionCurrency: "EGP", collectionMethod: "فيزا" };

    const totals = computeShiftTotals(record);
    expect(totals.byMethodCurrency["فيزا"].EGP).toBe(800);
    expect(totals.methodClosing["فيزا"].EGP).toBe(12800); // 12000 عهدة + 800 حصّلت الشيفت ده
  });

  it("does not create a cash entry inside methodClosing (cash has its own closingCash)", () => {
    const rooms = [{ number: 601 }];
    const record = freshShiftRecord("2026-09-05", "morning", "Ahmed", "ahmed", rooms, { EGP: 500 });
    record.rows[0] = { ...record.rows[0], collectionAmt: "100", collectionCurrency: "EGP", collectionMethod: "كاش" };
    const totals = computeShiftTotals(record);
    expect(totals.methodClosing["كاش"]).toBeUndefined();
  });

  it("tracks a method with zero handover but some collection this shift", () => {
    const rooms = [{ number: 601 }];
    const record = freshShiftRecord("2026-09-05", "morning", "Ahmed", "ahmed", rooms, { EGP: 0 });
    record.rows[0] = { ...record.rows[0], collectionAmt: "300", collectionCurrency: "EGP", collectionMethod: "انستاباي" };
    const totals = computeShiftTotals(record);
    expect(totals.methodClosing["انستاباي"].EGP).toBe(300); // 0 عهدة + 300 حصّلت
  });

  it("defaults methodHandover to an empty object when none is given", () => {
    const rooms = [{ number: 601 }];
    const record = freshShiftRecord("2026-09-05", "morning", "Ahmed", "ahmed", rooms, { EGP: 0 });
    expect(record.methodHandover).toEqual({});
  });
});

describe("directBookingPaymentsByMethod (تحصيل الحجوزات بطرق الدفع غير الكاش - كان مفقود من التقرير)", () => {
  it("counts a Visa payment on a booking by method and currency", () => {
    const bookings = [{ id: "b1", paymentMethod: "فيزا", currency: "EGP", amountPaid: 1500 }];
    const result = directBookingPaymentsByMethod(bookings);
    expect(result["فيزا"].EGP).toBe(1500);
  });

  it("sums multiple bookings paid with the same method and currency", () => {
    const bookings = [
      { id: "b1", paymentMethod: "انستاباي", currency: "EGP", amountPaid: 500 },
      { id: "b2", paymentMethod: "انستاباي", currency: "EGP", amountPaid: 300 },
    ];
    const result = directBookingPaymentsByMethod(bookings);
    expect(result["انستاباي"].EGP).toBe(800);
  });

  it("keeps different methods and currencies separate", () => {
    const bookings = [
      { id: "b1", paymentMethod: "فودافون كاش", currency: "EGP", amountPaid: 200 },
      { id: "b2", paymentMethod: "تحويل بنكي", currency: "USD", amountPaid: 50 },
    ];
    const result = directBookingPaymentsByMethod(bookings);
    expect(result["فودافون كاش"].EGP).toBe(200);
    expect(result["تحويل بنكي"].USD).toBe(50);
  });

  it("excludes cash payments (tracked separately via the shift drawer ledger)", () => {
    const bookings = [{ id: "b1", paymentMethod: "كاش", currency: "EGP", amountPaid: 1000 }];
    const result = directBookingPaymentsByMethod(bookings);
    expect(result["كاش"]).toBeUndefined();
  });

  it("excludes online-paid bookings (reported separately in the online section)", () => {
    const bookings = [{ id: "b1", paymentMethod: "فيزا", currency: "EGP", amountPaid: 1000, paymentDetails: { onlinePaid: true } }];
    const result = directBookingPaymentsByMethod(bookings);
    expect(result["فيزا"]).toBeUndefined();
  });

  it("ignores bookings with no amount actually paid yet", () => {
    const bookings = [{ id: "b1", paymentMethod: "فيزا", currency: "EGP", amountPaid: 0 }];
    const result = directBookingPaymentsByMethod(bookings);
    expect(result["فيزا"]).toBeUndefined();
  });

  it("excludes bookings already journaled into a shift ledger (avoids double-counting)", () => {
    const bookings = [{ id: "b1", paymentMethod: "فيزا", currency: "EGP", amountPaid: 1500 }];
    const journaledIds = new Set(["b1"]);
    const result = directBookingPaymentsByMethod(bookings, journaledIds);
    expect(result["فيزا"]).toBeUndefined();
  });
});

describe("computeShiftTotals - room row collectionAmt can be negative (booking refund merged into the normal ledger row)", () => {
  it("a positive collectionAmt on a room row still works exactly as before", () => {
    const rooms = [{ number: 601 }];
    const record = freshShiftRecord("2026-09-05", "morning", "Ahmed", "ahmed", rooms, { EGP: 1000 });
    record.rows[0] = { ...record.rows[0], collectionAmt: 500, collectionCurrency: "EGP", collectionMethod: "كاش" };
    const t = computeShiftTotals(record);
    expect(t.totalCollections.EGP).toBe(500);
    expect(t.cashCollections.EGP).toBe(500);
    expect(t.closingCash.EGP).toBe(1500);
  });

  it("a negative collectionAmt (refund for a cancelled booking, posted automatically) reduces totals and the cash drawer", () => {
    const rooms = [{ number: 601 }];
    const record = freshShiftRecord("2026-09-05", "morning", "Ahmed", "ahmed", rooms, { EGP: 1000 });
    record.rows[0] = { ...record.rows[0], collectionAmt: -400, collectionCurrency: "EGP", collectionMethod: "كاش" };
    const t = computeShiftTotals(record);
    expect(t.totalCollections.EGP).toBe(-400);
    expect(t.closingCash.EGP).toBe(600);
  });

  it("a negative non-cash collectionAmt affects byMethodCurrency but not the cash drawer", () => {
    const rooms = [{ number: 601 }];
    const record = freshShiftRecord("2026-09-05", "morning", "Ahmed", "ahmed", rooms, { EGP: 1000 });
    record.rows[0] = { ...record.rows[0], collectionAmt: -200, collectionCurrency: "EGP", collectionMethod: "فيزا" };
    const t = computeShiftTotals(record);
    expect(t.byMethodCurrency["فيزا"].EGP).toBe(-200);
    expect(t.cashCollections.EGP || 0).toBe(0);
    expect(t.closingCash.EGP).toBe(1000);
  });

  it("is a no-op when bookingCollections (internal double-count-prevention tracking) is missing", () => {
    const rooms = [{ number: 601 }];
    const record = freshShiftRecord("2026-09-05", "morning", "Ahmed", "ahmed", rooms, { EGP: 1000 });
    delete record.bookingCollections;
    const t = computeShiftTotals(record);
    expect(t.closingCash.EGP).toBe(1000);
  });
});

describe("emptyPaymentDetails online fields", () => {
  it("defaults onlinePaid to false and has no platform commission field (commission was removed)", () => {
    const pd = emptyPaymentDetails();
    expect(pd.onlinePaid).toBe(false);
    expect(pd).not.toHaveProperty("commissionPct");
  });
});

describe("applyCollectionToRows (booking money posted into the normal ledger rows)", () => {
  const baseRows = () => [emptyLedgerRow(601), emptyLedgerRow(602)];
  const entry = (over = {}) => ({ room: 601, amount: 1200, currency: "EGP", method: "كاش", guestName: "Ahmed", note: "تحصيل", ...over });

  it("uses the room's empty row and fills amount/method/currency", () => {
    const { rows, added } = applyCollectionToRows(baseRows(), entry());
    expect(added).toBe(false);
    expect(rows).toHaveLength(2);
    expect(rows[0].collectionAmt).toBe(1200);
    expect(rows[0].collectionMethod).toBe("كاش");
    expect(rows[0].collectionDesc).toContain("Ahmed");
  });

  it("merges into the same row when method and currency match (collection then refund nets to zero)", () => {
    let { rows } = applyCollectionToRows(baseRows(), entry());
    ({ rows } = applyCollectionToRows(rows, entry({ amount: -1200, note: "رد فلوس" })));
    expect(rows).toHaveLength(2);
    expect(rows[0].collectionAmt).toBe(0);
    expect(rows[0].collectionDesc).toContain("رد فلوس");
  });

  it("adds a SECOND row for the same room instead of mixing a different currency into the cell", () => {
    let { rows } = applyCollectionToRows(baseRows(), entry());
    const res = applyCollectionToRows(rows, entry({ amount: 50, currency: "USD", method: "فيزا", guestName: "Mody" }));
    expect(res.added).toBe(true);
    expect(res.rows).toHaveLength(3);
    expect(res.rows[0].collectionAmt).toBe(1200);
    expect(res.rows[0].collectionCurrency).toBe("EGP");
    expect(res.rows[2]).toMatchObject({ room: 601, collectionAmt: 50, collectionCurrency: "USD", collectionMethod: "فيزا" });
  });

  it("totals stay correct across the mixed rows (cash EGP drawer vs visa USD)", () => {
    let { rows } = applyCollectionToRows(baseRows(), entry());
    ({ rows } = applyCollectionToRows(rows, entry({ amount: -1200, note: "رد فلوس" })));
    ({ rows } = applyCollectionToRows(rows, entry({ amount: 1400, guestName: "Mody" })));
    ({ rows } = applyCollectionToRows(rows, entry({ amount: 50, currency: "USD", method: "فيزا" })));
    const rec = { ...freshShiftRecord("2026-10-06", "morning", "x", "x", [{ number: 601 }, { number: 602 }]), rows };
    const t = computeShiftTotals(rec);
    expect(t.cashCollections.EGP).toBe(1400);
    expect(t.totalCollections.USD).toBe(50);
    expect(t.byMethodCurrency["فيزا"].USD).toBe(50);
    expect(t.closingCash.EGP).toBe(1400);
  });

  it("ignores a zero amount and never mutates the original rows", () => {
    const original = baseRows();
    const snap = JSON.stringify(original);
    const res = applyCollectionToRows(original, entry({ amount: 0 }));
    expect(res.rows).toBe(original);
    applyCollectionToRows(original, entry());
    expect(JSON.stringify(original)).toBe(snap);
  });
});

describe("refundDueAmount", () => {
  it("is 0 when no refund request is pending", () => {
    expect(refundDueAmount({ refundPending: false, status: "ملغي", amountPaid: 500, totalRoom: 500 })).toBe(0);
  });
  it("cancelled booking: everything paid is due back", () => {
    expect(refundDueAmount({ refundPending: true, status: "ملغي", amountPaid: 500, totalRoom: 500, extras: {} })).toBe(500);
  });
  it("shortened stay: only the excess over the new grand total is due back", () => {
    expect(refundDueAmount({ refundPending: true, status: "تم تسجيل الخروج", amountPaid: 400, totalRoom: 200, extras: {} })).toBe(200);
    expect(refundDueAmount({ refundPending: true, status: "تم تسجيل الخروج", amountPaid: 1200, totalRoom: 0, extras: {} })).toBe(1200);
  });
});

describe("rebaseShiftRecord (typing in the ledger while a refund/collection lands)", () => {
  const mk = (rows, extra = {}) => ({ rows, cafeteria: emptyLedgerRow("كافيتيريا"), handover: { EGP: 0 }, shiftNotes: "", ...extra });
  it("keeps the server's new refund AND the staff member's own edit on another row", () => {
    const base = mk([emptyLedgerRow(601), emptyLedgerRow(602)]);
    const mine = { ...base, rows: [base.rows[0], { ...base.rows[1], expenseAmt: 50, expenseDesc: "ماء" }] };
    const fresh = { ...base, rows: [{ ...base.rows[0], collectionAmt: -1200, collectionDesc: "رد فلوس" }, base.rows[1]], updatedAt: "t2" };
    const out = rebaseShiftRecord(base, mine, fresh);
    expect(out.rows[0].collectionAmt).toBe(-1200);
    expect(out.rows[1].expenseAmt).toBe(50);
    expect(out.updatedAt).toBe("t2");
  });
  it("only the fields I changed override the server on the same row", () => {
    const base = mk([emptyLedgerRow(601)]);
    const mine = { ...base, rows: [{ ...base.rows[0], expenseAmt: 10 }] };
    const fresh = { ...base, rows: [{ ...base.rows[0], collectionAmt: -300 }], updatedAt: "t3" };
    const out = rebaseShiftRecord(base, mine, fresh);
    expect(out.rows[0].collectionAmt).toBe(-300);
    expect(out.rows[0].expenseAmt).toBe(10);
  });
  it("carries my notes edit and keeps server rows appended after my base", () => {
    const base = mk([emptyLedgerRow(601)]);
    const mine = { ...base, shiftNotes: "ملاحظة" };
    const fresh = { ...base, rows: [base.rows[0], { ...emptyLedgerRow(601), collectionAmt: -5 }], updatedAt: "t4" };
    const out = rebaseShiftRecord(base, mine, fresh);
    expect(out.shiftNotes).toBe("ملاحظة");
    expect(out.rows.length).toBe(2);
  });
});

describe("applyCollectionToRows - صف مستقل لكل حجز (تسكين مكرر)", () => {
  const baseRows = () => [emptyLedgerRow(601), emptyLedgerRow(602)];
  const entry = (over = {}) => ({ room: 601, amount: 100, currency: "USD", method: "كاش", guestName: "Old", note: "تحصيل", bookingId: "b-old", ...over });

  it("أول حجز بياخد صف الغرفة الفاضي وبيتربط بيه", () => {
    const { rows } = applyCollectionToRows(baseRows(), entry());
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ bookingId: "b-old", collectionAmt: 100 });
  });

  it("حجز تاني على نفس الغرفة (نفس الوسيلة والعملة) بياخد صف جديد منفصل مش بيتدمج", () => {
    let { rows } = applyCollectionToRows(baseRows(), entry());
    ({ rows } = applyCollectionToRows(rows, entry({ bookingId: "b-new", guestName: "New", amount: 60 })));
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ bookingId: "b-old", collectionAmt: 100 });
    expect(rows[2]).toMatchObject({ room: 601, bookingId: "b-new", collectionAmt: 60 });
    expect(rows[2].collectionDesc).toContain("New");
  });

  it("تحصيل تاني لنفس الحجز بنفس الوسيلة بيتجمّع على صفه هو", () => {
    let { rows } = applyCollectionToRows(baseRows(), entry());
    ({ rows } = applyCollectionToRows(rows, entry({ bookingId: "b-new", amount: 60 })));
    ({ rows } = applyCollectionToRows(rows, entry({ bookingId: "b-new", amount: 40 })));
    expect(rows).toHaveLength(3);
    expect(rows[2].collectionAmt).toBe(100);
    expect(rows[0].collectionAmt).toBe(100);
  });

  it("رد فلوس (سالب) لحجز بيتخصم من صفه هو بس", () => {
    let { rows } = applyCollectionToRows(baseRows(), entry());
    ({ rows } = applyCollectionToRows(rows, entry({ bookingId: "b-new", amount: 60 })));
    ({ rows } = applyCollectionToRows(rows, entry({ bookingId: "b-new", amount: -60, note: "رد فلوس" })));
    expect(rows[2].collectionAmt).toBe(0);
    expect(rows[0].collectionAmt).toBe(100);
  });

  it("وسيلة مختلفة لنفس الحجز بتعمل صف خاص بيها برضه (من غير خلط وسائل)", () => {
    let { rows } = applyCollectionToRows(baseRows(), entry());
    ({ rows } = applyCollectionToRows(rows, entry({ method: "فيزا", amount: 50 })));
    expect(rows).toHaveLength(3);
    expect(rows[2]).toMatchObject({ bookingId: "b-old", collectionMethod: "فيزا", collectionAmt: 50 });
  });
});

describe("بنود مصاريف وإيرادات الفندق (hotelRows)", () => {
  it("اليومية الجديدة فيها بند فندق فاضي", () => {
    const rec = freshShiftRecord("2026-09-05", "morning", "Ahmed", "ahmed", [{ number: 601 }], { EGP: 0 });
    expect(rec.hotelRows).toHaveLength(1);
    expect(rec.hotelRows[0].room).toBe("فندق");
  });

  it("المصاريف والإيرادات بتدخل في إجماليات اليومية ورصيد الخزينة والبنود", () => {
    const rec = freshShiftRecord("2026-09-05", "morning", "Ahmed", "ahmed", [{ number: 601 }], { EGP: 1000 });
    rec.hotelRows = [
      { ...emptyLedgerRow("فندق"), expenseAmt: 200, expenseCategory: "كهرباء ومياه", expenseCurrency: "EGP", collectionAmt: 500, collectionMethod: "كاش", collectionCurrency: "EGP" },
      { ...emptyLedgerRow("فندق"), expenseAmt: 30, expenseCategory: "صيانة", expenseCurrency: "USD" },
    ];
    const t = computeShiftTotals(rec);
    expect(t.totalExpenses).toEqual({ EGP: 200, USD: 30 });
    expect(t.totalCollections).toEqual({ EGP: 500 });
    expect(t.byCategory["كهرباء ومياه"]).toEqual({ EGP: 200 });
    expect(t.closingCash.EGP).toBe(1000 + 500 - 200);
    expect(t.closingCash.USD).toBe(-30);
  });

  it("سجل قديم من غير hotelRows بيتحسب عادي", () => {
    const rec = freshShiftRecord("2026-09-05", "morning", "Ahmed", "ahmed", [{ number: 601 }], { EGP: 0 });
    delete rec.hotelRows;
    expect(() => computeShiftTotals(rec)).not.toThrow();
  });

  it("الدمج المتزامن (rebase) بيحفظ تعديل الموظف على بنود الفندق فوق نسخة السيرفر", () => {
    const base = freshShiftRecord("2026-09-05", "morning", "Ahmed", "ahmed", [{ number: 601 }], { EGP: 0 });
    const mine = { ...base, hotelRows: [{ ...base.hotelRows[0], expenseAmt: 75 }] };
    const fresh = { ...base, updatedAt: "later", rows: [{ ...base.rows[0], collectionAmt: -100 }] };
    const merged = rebaseShiftRecord(base, mine, fresh);
    expect(merged.hotelRows[0].expenseAmt).toBe(75);
    expect(merged.rows[0].collectionAmt).toBe(-100);
  });
});

describe("refundStatusOf - حالة الفلوس لحجز ملغي", () => {
  const base = { currency: "USD", status: "ملغي", amountPaid: 0, refundPending: false, refundDecision: null, refundedAmount: null };
  it("حجز شغّال ماحصلش فيه رد => null", () => {
    expect(refundStatusOf({ ...base, status: "مؤكد", amountPaid: 100 })).toBeNull();
  });
  it("ملغي من غير فلوس => none", () => {
    expect(refundStatusOf(base).kind).toBe("none");
  });
  it("ملغي وعليه طلب رد معلّق => pending بالمبلغ", () => {
    const r = refundStatusOf({ ...base, amountPaid: 300, refundPending: true });
    expect(r.kind).toBe("pending");
    expect(r.text).toContain("٣٠٠");
  });
  it("اترد => refunded بالمبلغ ومين رد", () => {
    const r = refundStatusOf({ ...base, amountPaid: 0, refundDecision: "refunded", refundedAmount: 300, refundedBy: "rawan" });
    expect(r.kind).toBe("refunded");
    expect(r.text).toContain("rawan");
  });
  it("رفض الرد => kept وبيذكر إن الفلوس فضلت", () => {
    const r = refundStatusOf({ ...base, amountPaid: 200, refundDecision: "kept" });
    expect(r.kind).toBe("kept");
    expect(r.text).toContain("٢٠٠");
  });
  it("ملغي وفيه فلوس من غير قرار => holding", () => {
    expect(refundStatusOf({ ...base, amountPaid: 50 }).kind).toBe("holding");
  });
  it("حجز شغّال اترد منه جزء (تقصير) => refunded", () => {
    expect(refundStatusOf({ ...base, status: "تم تسجيل الخروج", amountPaid: 200, refundDecision: "refunded", refundedAmount: 200 }).kind).toBe("refunded");
  });
});
