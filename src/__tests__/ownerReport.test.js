import { describe, it, expect } from "vitest";
import { buildRoomsSheet, buildShiftSheet, buildOwnerReport, bookingsForDay, paidNights, moneyText, dayMonth, stripMarks } from "../domain/ownerReport";
import { freshShiftRecord, emptyLedgerRow, computeShiftTotals, stripBookingFromRecord, blankShiftRecord } from "../domain/money";

const rooms = [{ number: 610, name: "(W)610(D)" }, { number: 611, name: "(W)611(D)" }, { number: 612, name: "(b)612(D)" }];
const booking = (o) => ({ id: "b" + o.room, status: "مؤكد", currency: "EGP", extras: {}, earlyCheckin: { applied: false, fee: 0 }, paymentDetails: {}, otherCharges: {}, otherPaid: {}, guestCodes: [], pax: 1, source: "مباشر", amountPaid: 0, ...o });
const DAY = "2026-11-13";
const clean = (sheet) => sheet.rows.map((r) => Object.fromEntries(Object.entries(r.cells).map(([k, v]) => [k, v.map(stripMarks).join(" | ")])));

describe("تقرير الأونر - كشف الغرف", () => {
  it("صف لكل غرفة: الفاضي فاضي، والمسكون بالسعر × المدة والمدفوع وكام ليلة والمتبقي", () => {
    const bookings = [
      booking({ room: 610, guestName: "علي", guestCodes: ["84"], checkin: DAY, checkout: "2026-11-17", priceNight: 1600, totalRoom: 6400, amountPaid: 3200, source: "Booking.com" }),
      booking({ room: 611, guestName: "منى", checkin: "2026-11-12", checkout: "2026-11-14", priceNight: 1000, totalRoom: 2000, amountPaid: 2000 }),
    ];
    const pay = new Map([["b610", [{ method: "فيزا", details: { senderNumber: "1234" }, amount: 3200, currency: "EGP" }]]]);
    const sheet = buildRoomsSheet({ rooms, bookings, date: DAY, paymentsIndex: pay });
    const [r610, r611, r612] = clean(sheet);
    expect(sheet.rows).toHaveLength(3);
    expect(r610).toMatchObject({ guest: "84 | علي", price: "1,600 × 4 | 6,400 EGP", in: "13/11", out: "17/11", total: "6,400 EGP", nights: "2 من 4", due: "3,200 EGP", source: "Booking.com | دخول النهارده" });
    expect(r610.paid).toBe("3,200 EGP | فيزا 3,200 ****1234");
    expect(sheet.rows[0].tone).toBe("due");
    expect(r611).toMatchObject({ nights: "2 من 2", due: "خالص" });
    expect(sheet.rows[2].tone).toBe("empty");
    expect(Object.keys(r612)).toEqual(["room"]);
    expect(Object.fromEntries(sheet.summary.map(([l, v]) => [l, stripMarks(v)]))).toMatchObject({ "غرف مشغولة": "2 من 3", "دخول النهارده": "1", "إجمالي المتبقي على النزلاء": "3,200 EGP" });
  });

  it("اللي خارج النهارده مابيتكتبش تاني في ورقة يوم خروجه - بيتكتب بس الحجز الجديد اللي اتسكّن، والملغي مابيطلعش", () => {
    const bookings = [
      booking({ id: "old", room: 610, guestName: "قديم", checkin: "2026-11-11", checkout: DAY, priceNight: 100, totalRoom: 200, amountPaid: 200 }),
      booking({ id: "new", room: 610, guestName: "جديد", checkin: DAY, checkout: "2026-11-14", priceNight: 100, totalRoom: 100 }),
      booking({ id: "gone", room: 612, guestName: "ماشي", checkin: "2026-11-11", checkout: DAY, priceNight: 100, totalRoom: 200, amountPaid: 200 }),
      booking({ id: "x", room: 611, guestName: "ملغي", status: "ملغي", checkin: DAY, checkout: "2026-11-14", priceNight: 100, totalRoom: 100 }),
    ];
    expect(bookingsForDay(bookings, 610, DAY).map((b) => b.id)).toEqual(["new"]);
    expect(bookingsForDay(bookings, 612, DAY)).toEqual([]);
    expect(bookingsForDay(bookings, 611, DAY)).toEqual([]);
    const sheet = buildRoomsSheet({ rooms, bookings, date: DAY });
    expect(sheet.rows).toHaveLength(3);                       // صف واحد لكل غرفة - مفيش تكرار
    expect(clean(sheet)[0].guest).toBe("جديد");
    expect(sheet.rows[2].tone).toBe("empty");                 // 612: خرج النهارده فخانته فاضية
    expect(Object.fromEntries(sheet.summary)).toMatchObject({ "خروج النهارده": "2", "دخول النهارده": "1" });
  });

  it("حجز مدفوع أونلاين: الغرفة خالص وكل الليالي مدفوعة، والخدمات بتفضل متبقي", () => {
    const b = booking({ room: 610, guestName: "BK", checkin: DAY, checkout: "2026-11-16", priceNight: 19, totalRoom: 57, currency: "USD", paymentDetails: { onlinePaid: true }, extras: { laundry: 5 } });
    expect(paidNights(b)).toEqual({ paid: 3, nights: 3 });
    const row = clean(buildRoomsSheet({ rooms, bookings: [b], date: DAY }))[0];
    expect(row.price).toBe("19 × 3 | خالص (أونلاين)");
    expect(row.services).toBe("غسيل 5 USD");
    expect(row.due).toBe("5 USD");
  });

  it("دفع كام ليلة: المدفوع بعد الكافيتيريا ÷ سعر الليلة، ومابيعدّيش عدد الليالي", () => {
    const base = { checkin: DAY, checkout: "2026-11-16", priceNight: 100, totalRoom: 300 };
    expect(paidNights(booking({ room: 610, ...base, amountPaid: 250 })).paid).toBe(2);
    expect(paidNights(booking({ room: 610, ...base, amountPaid: 250, extras: { cafeteria: 60, cafeteriaPaid: 60 } })).paid).toBe(1);
    expect(paidNights(booking({ room: 610, ...base, amountPaid: 900 })).paid).toBe(3);
  });
});

describe("تقرير الأونر - ورقة الشيفت", () => {
  it("المربعات زي الورق: الأربعة الأولى كاش بالجنيه (عهدة + تحصيل - مصاريف = رصيد)، والفيزا تحصيل الشيفت بس، والعملة، وإجمالي الكافيتيريا", () => {
    const rec = freshShiftRecord(DAY, "morning", "أحمد", "ahmed", rooms, { EGP: 500 }, { "فيزا": { EGP: 6245 } });
    rec.rows[0] = { ...rec.rows[0], collectionAmt: 3200, collectionMethod: "فيزا", collectionCurrency: "EGP", paymentDetails: { senderNumber: "1234" } };
    rec.rows.push({ ...emptyLedgerRow(610), collectionAmt: 1261, collectionMethod: "كاش", collectionCurrency: "EGP" });
    rec.rows[1] = { ...rec.rows[1], collectionAmt: 50, collectionMethod: "كاش", collectionCurrency: "EUR" };
    rec.rows[2] = { ...rec.rows[2], collectionAmt: 300, collectionMethod: "تحويل بنكي / انستاباي", paymentDetails: { senderName: "x", senderNumber: "0100000000" } };
    rec.cafeteriaRows = [
      { ...emptyLedgerRow("كافيتيريا"), kind: "guest", who: "علي", bookingId: "b610", collectionAmt: 120 },
      { ...emptyLedgerRow("كافيتيريا"), kind: "staff", who: "سارة", consumerKey: "sara", collectionAmt: 40 },
    ];
    rec.hotelRows = [{ ...emptyLedgerRow("فندق"), expenseDesc: "مكوى", expenseAmt: 70 }];
    rec.helpers = ["sara"]; rec.shiftNotes = "تمام";
    const sheet = buildShiftSheet({ record: rec, rooms, staffNames: { sara: "سارة" } });
    const rows = clean(sheet);
    expect(rows[0].collection).toBe("فيزا 3,200 EGP ****1234 | كاش 1,261 EGP");
    expect(rows[1].collection).toBe("كاش 50 EUR");
    expect(rows.map((r) => r.room).slice(-3)).toEqual(["كافيتيريا النزلاء", "كافيتيريا الاستاف", "مصاريف الفندق"]);
    expect(rows.at(-1).expenses).toBe("مكوى 70 EGP");
    expect(sheet.summary.map(([l, v]) => [l, stripMarks(v)])).toEqual([
      ["العهدة", "500 EGP"], ["إجمالي التحصيل", "1,421 EGP"], ["إجمالي المصاريف", "70 EGP"], ["رصيد الخزينة", "1,851 EGP"],     // 500 + (1,261 + 120 + 40) - 70
      ["الفيزا", "3,200 EGP"], ["انستاباي", "300 EGP"], ["فودافون كاش", "0"], ["عملة", "50 EUR"],                               // الفيزا = تحصيل الشيفت بس (من غير العهدة 6,245)
      ["إجمالي الكافيتيريا", "160 EGP"],
    ]);
    expect(Object.fromEntries(sheet.head)).toMatchObject({ "الاسم": "أحمد + سارة", "معاد الشيفت": "8ص - 4م", "الحالة": "لسه مفتوح" });
    expect(sheet.notes).toEqual(["ملاحظات: تمام"]);
  });

  it("مدفوع قبل السيستم بيظهر في خانة المدفوع", () => {
    const b = booking({ room: 610, guestName: "قديم", checkin: DAY, checkout: "2026-11-15", priceNight: 500, totalRoom: 1000, amountPaid: 700, paymentDetails: { priorPaid: 700 } });
    expect(clean(buildRoomsSheet({ rooms, bookings: [b], date: DAY }))[0].paid).toBe("700 EGP | قبل السيستم 700 EGP");
  });

  it("التقرير الكامل: كشف الغرف + ورقة لكل شيفت اتفتح بالترتيب (اللي لسه ماجاش مابيطلعش)", () => {
    const ev = freshShiftRecord(DAY, "evening", "سارة", "sara", rooms), mo = freshShiftRecord(DAY, "morning", "أحمد", "ahmed", rooms);
    expect(buildOwnerReport({ rooms, bookings: [], date: DAY, records: [ev, mo] }).map((s) => s.id)).toEqual(["rooms", "shift-morning", "shift-evening"]);
    expect(buildOwnerReport({ rooms, bookings: [], date: DAY, records: [] }).map((s) => s.id)).toEqual(["rooms"]);
  });

  it("مساعدات: التاريخ يوم/شهر، والمبالغ الصفرية بتتشال", () => {
    expect(dayMonth("2026-11-03")).toBe("3/11");
    expect(stripMarks(moneyText({ EGP: 0, USD: 20 }))).toBe("20 USD");
    expect(moneyText({})).toBe("0");
  });
});

describe("الكافيتيريا في إجماليات الشيفت ومسح أثر حجز", () => {
  it("كافيتيريا النزلاء وكافيتيريا الاستاف كل واحدة برقمها، ومفصولين عن تحصيل الغرف", () => {
    const rec = freshShiftRecord(DAY, "morning", "أحمد", "ahmed", rooms, { EGP: 0 });
    rec.rows[0] = { ...rec.rows[0], collectionAmt: 1000 };
    rec.cafeteriaRows = [{ ...emptyLedgerRow("كافيتيريا"), kind: "guest", bookingId: "b1", collectionAmt: 120 }, { ...emptyLedgerRow("كافيتيريا"), kind: "staff", collectionAmt: 40 }];
    const t = computeShiftTotals(rec);
    expect([t.roomCollections, t.cafeteriaGuest, t.cafeteriaStaff, t.cafeteriaCollections, t.totalCollections]).toEqual([{ EGP: 1000 }, { EGP: 120 }, { EGP: 40 }, { EGP: 160 }, { EGP: 1160 }]);
  });
  it("مسح أثر حجز من يومية: تحصيله بيتشال (غرف وكافيتيريا) وصف الغرفة بيرجع فاضي، وباقي الصفوف زي ما هي", () => {
    const rec = freshShiftRecord(DAY, "morning", "أحمد", "ahmed", rooms, { EGP: 0 });
    rec.rows[0] = { ...rec.rows[0], bookingId: "bad", collectionAmt: 800 };
    rec.rows.push({ ...emptyLedgerRow(610), bookingId: "bad", collectionAmt: 50, collectionMethod: "فيزا" });
    rec.rows[1] = { ...rec.rows[1], bookingId: "good", collectionAmt: 300 };
    rec.cafeteriaRows = [{ ...emptyLedgerRow("كافيتيريا"), kind: "guest", bookingId: "bad", collectionAmt: 20 }];
    rec.bookingCollections = [{ id: "1", bookingId: "bad" }, { id: "2", bookingId: "good" }];
    const out = stripBookingFromRecord(rec, "bad");
    expect(out.rows.map((r) => [r.room, Number(r.collectionAmt) || 0])).toEqual([[610, 0], [611, 300], [612, 0]]);
    expect(out.cafeteriaRows).toEqual([]);
    expect(out.bookingCollections).toEqual([{ id: "2", bookingId: "good" }]);
    expect(computeShiftTotals(out).totalCollections).toEqual({ EGP: 300 });
    expect(computeShiftTotals(blankShiftRecord(rec)).totalCollections).toEqual({});
  });
});
