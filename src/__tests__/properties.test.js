import { describe, it, expect } from "vitest";
import {
  applyCollectionToRows, applyCafeteriaCollection, computeShiftTotals, emptyLedgerRow, freshShiftRecord, rebaseShiftRecord,
  splitPaymentForCafeteria, cafeteriaOutstanding, cleanPaymentDetailsFor, validatePaymentDetailsFor, describePaymentDetails,
  normalizeLast4, normalizePhone, sameDetails, PAYMENT_METHODS, COMMON_CURRENCIES, methodTransactions, missingPaymentDetails, bookingGrandTotal, bookingHotelTotal, bookingAmountDue,
} from "../domain/money";

const mulberry32 = (a) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const ITER = 1500;
const r2 = (n) => Math.round(n * 100) / 100;
const near = (a, b) => Math.abs(a - b) < 0.011 * 40;

describe("خصائص عامة (property tests) على منطق التحصيل: آلاف التسلسلات العشوائية", () => {
  it("مهما كان ترتيب التحصيل/الرد بأي وسيلة وعملة وكارت: مجموع اليومية = مجموع العمليات، والأرصدة متسقة، ومفيش صف بيخلط وسيلتين", () => {
    for (let seed = 1; seed <= ITER; seed++) {
      const rnd = mulberry32(seed);
      const pick = (a) => a[Math.floor(rnd() * a.length)];
      const rooms = [601, 602, 603];
      let rec = { ...freshShiftRecord("2030-01-01", "morning", "a", "a", rooms.map((n) => ({ number: n })), { EGP: 100, USD: 50 }, { "فيزا": { USD: 200 } }) };
      const expectedByCur = {}, expectedByMethodCur = {};
      const n = 5 + Math.floor(rnd() * 40);
      for (let i = 0; i < n; i++) {
        const method = pick(PAYMENT_METHODS), currency = pick(COMMON_CURRENCIES);
        const sign = rnd() < 0.15 ? -1 : 1;                                   // رد فلوس
        const amount = sign * r2(1 + rnd() * 500);
        const details = method === "فيزا" ? { senderNumber: pick(["1111", "2222", "3333"]) } : method === "كاش" ? {} : { senderName: pick(["أ", "ب"]), senderNumber: pick(["01011112222", "01022223333"]) };
        const bookingId = rnd() < 0.8 ? pick(["b1", "b2", "b3", "b4"]) : undefined;
        const cafe = rnd() < 0.3;
        if (cafe) {
          rec = { ...rec, cafeteriaRows: applyCafeteriaCollection(rec.cafeteriaRows, { kind: pick(["guest", "staff"]), bookingId, consumerKey: pick(["x", "y"]), who: "w", room: pick(rooms), amount, currency, method, details: cleanPaymentDetailsFor(method, details), note: "n" }).rows };
        } else {
          rec = { ...rec, rows: applyCollectionToRows(rec.rows, { id: `e${i}`, bookingId, room: pick(rooms), guestName: "g", amount, currency, method, details: cleanPaymentDetailsFor(method, details), note: "n" }).rows };
        }
        expectedByCur[currency] = (expectedByCur[currency] || 0) + amount;
        expectedByMethodCur[method] = expectedByMethodCur[method] || {};
        expectedByMethodCur[method][currency] = (expectedByMethodCur[method][currency] || 0) + amount;
      }
      const t = computeShiftTotals(rec);
      for (const cur of Object.keys(expectedByCur)) {
        expect(near(t.totalCollections[cur] || 0, expectedByCur[cur]), `seed ${seed}: مجموع ${cur}`).toBe(true);
        const sumMethods = Object.values(t.byMethodCurrency).reduce((a, m) => a + (m[cur] || 0), 0);
        expect(near(sumMethods, t.totalCollections[cur] || 0), `seed ${seed}: مجموع الوسائل = الإجمالي (${cur})`).toBe(true);
      }
      for (const m of Object.keys(expectedByMethodCur)) for (const cur of Object.keys(expectedByMethodCur[m])) expect(near(t.byMethodCurrency[m]?.[cur] || 0, expectedByMethodCur[m][cur]), `seed ${seed}: ${m} ${cur}`).toBe(true);
      // الكاش: رصيد الخزينة = العهدة + تحصيل الكاش - المصاريف
      for (const cur of Object.keys(t.closingCash)) expect(near(t.closingCash[cur], (rec.handover[cur] || 0) + (t.cashCollections[cur] || 0) - (t.totalExpenses[cur] || 0)), `seed ${seed}: رصيد الخزينة ${cur}`).toBe(true);
      // الوسائل التانية: الإجمالي = عهدة + تحصيل، والكاش مش جواها
      expect(t.methodClosing["كاش"]).toBeUndefined();
      for (const m of Object.keys(t.methodClosing)) for (const cur of Object.keys(t.methodClosing[m])) expect(near(t.methodClosing[m][cur], (rec.methodHandover[m]?.[cur] || 0) + (t.byMethodCurrency[m]?.[cur] || 0)), `seed ${seed}: متابعة ${m} ${cur}`).toBe(true);
      // مفيش صفين بنفس (غرفة/حجز/وسيلة/عملة/تفاصيل) وكلهم فيهم مبلغ: لازم اتدمجوا
      const seen = new Set();
      rec.rows.filter((r) => r.bookingId && Number(r.collectionAmt) !== 0).forEach((r) => {
        const key = [r.room, r.bookingId, r.collectionMethod, r.collectionCurrency, describePaymentDetails(r.collectionMethod, r.paymentDetails)].join("|");
        expect(seen.has(key), `seed ${seed}: صف مكرر ${key}`).toBe(false); seen.add(key);
      });
      // كل صف وسيلة واحدة وعملة واحدة (بالتعريف)، والتفاصيل الغريبة ماتدخلش صف وسيلة تانية
      [...rec.rows, ...rec.cafeteriaRows].filter((r) => r.collectionMethod === "كاش" && Number(r.collectionAmt) !== 0).forEach((r) => expect(describePaymentDetails("كاش", r.paymentDetails), `seed ${seed}`).toBe(""));
      // الفيزا بتفاصيل ٤ أرقام دايمًا (من غير اسم/ref)
      [...rec.rows, ...rec.cafeteriaRows].filter((r) => r.collectionMethod === "فيزا" && Number(r.collectionAmt) > 0).forEach((r) => { expect(r.paymentDetails.senderNumber).toMatch(/^\d{4}$/); expect(r.paymentDetails.senderName).toBe(""); expect(r.paymentDetails.ref).toBe(""); });
      // مفيش تحصيل موجب من غير تفاصيل صالحة بعد التنظيف
      expect(missingPaymentDetails(rec)).toEqual([]);
      // عمليات الوسيلة بتجمع على نفس الإجمالي
      for (const m of PAYMENT_METHODS.filter((x) => x !== "كاش")) {
        const tx = methodTransactions(rec, m);
        for (const cur of COMMON_CURRENCIES) expect(near(tx.filter((x) => x.currency === cur).reduce((a, x) => a + x.amount, 0), t.byMethodCurrency[m]?.[cur] || 0), `seed ${seed}: عمليات ${m} ${cur}`).toBe(true);
      }
    }
  });

  it("توزيع الدفعة على الكافيتيريا: الجزئين = المبلغ، والكافيتيريا ≤ المستحق، ومفيش سالب", () => {
    for (let seed = 1; seed <= ITER * 2; seed++) {
      const rnd = mulberry32(seed + 77);
      const cafe = r2(rnd() * 200), paid = r2(rnd() * cafe * 1.3);
      const b = { extras: { cafeteria: cafe, cafeteriaPaid: paid } };
      const amount = r2(rnd() * 400);
      const s = splitPaymentForCafeteria(b, amount);
      expect(s.cafeteria).toBeGreaterThanOrEqual(0); expect(s.rest).toBeGreaterThanOrEqual(-1e-9);
      expect(near(s.cafeteria + s.rest, amount)).toBe(true);
      expect(s.cafeteria).toBeLessThanOrEqual(cafeteriaOutstanding(b) + 1e-9);
      expect(s.cafeteria).toBeLessThanOrEqual(amount + 1e-9);
      if (amount > 0 && cafeteriaOutstanding(b) > 0) expect(s.cafeteria).toBeGreaterThan(0);        // الكافيتيريا بتتسدّد الأول
    }
    expect(splitPaymentForCafeteria({}, 50)).toEqual({ cafeteria: 0, rest: 50 });
    expect(splitPaymentForCafeteria({ extras: { cafeteria: 30 } }, -20)).toEqual({ cafeteria: 0, rest: -20 });
  });

  it("تنضيف تفاصيل الدفع: idempotent، والمدخلات الغريبة (نصوص، أرقام عربي، null، رموز) ماتكسرش حاجة", () => {
    const junk = [null, undefined, "", " ", "12", "١٢٣٤", "٤١١١ ١١١١ ١١١١ ١٢٣٤", "abcd", "12345678901234567890", "+20 (10) 1234-5678", "\u0000\u0007x", "😀١٢٣٤😀", { a: 1 }, 5555, ["1", "2"]];
    for (const m of [...PAYMENT_METHODS, "انستاباي", "تحويل بنكي", "حاجة غريبة"]) {
      for (const a of junk) for (const b of junk) {
        const d = { senderName: a, senderNumber: b, ref: a };
        const c1 = cleanPaymentDetailsFor(m, d), c2 = cleanPaymentDetailsFor(m, c1);
        expect(c2).toEqual(c1);
        expect(() => describePaymentDetails(m, d)).not.toThrow();
        expect(() => validatePaymentDetailsFor(m, d)).not.toThrow();
        expect(typeof validatePaymentDetailsFor(m, c1)).toBe("string");
        if (m === "فيزا") { expect(c1.senderNumber).toMatch(/^\d{0,4}$/); expect(c1.senderName).toBe(""); }
        if (m === "كاش") expect(c1).toEqual({ senderName: "", senderNumber: "", ref: "", onlinePaid: false });
        expect(sameDetails(m, c1, c1)).toBe(true);
      }
    }
    expect(normalizeLast4("٤١١١ ١١١١ ١١١١ ١٢٣٤")).toBe("1234");
    expect(normalizePhone("+٢٠ ١٠ ١٢٣٤")).toBe("+2010" + "1234");
  });

  it("إعادة دمج اليومية بعد تعارض (rebase): الخانات اللي غيّرها الموظف + اللي غيّرها السيرفر بيتحفظوا مع بعض", () => {
    for (let seed = 1; seed <= 400; seed++) {
      const rnd = mulberry32(seed + 5);
      const rooms = [{ number: 601 }, { number: 602 }, { number: 603 }];
      const base = freshShiftRecord("2030-01-01", "morning", "a", "a", rooms, { EGP: 0 });
      const mine = JSON.parse(JSON.stringify(base)), fresh = JSON.parse(JSON.stringify(base));
      const myIdx = Math.floor(rnd() * 3); let srvIdx = Math.floor(rnd() * 3);
      mine.rows[myIdx].expenseAmt = 50 + seed;
      mine.shiftNotes = `mine ${seed}`;
      fresh.rows[srvIdx] = { ...fresh.rows[srvIdx], collectionAmt: 70, collectionMethod: "فيزا", collectionDesc: "srv" };
      fresh.cafeteriaRows = [{ ...emptyLedgerRow("كافيتيريا"), kind: "staff", collectionAmt: 9, collectionMethod: "كاش", collectionDesc: "srv" }];
      const out = rebaseShiftRecord(base, mine, fresh);
      expect(Number(out.rows[myIdx].expenseAmt)).toBe(50 + seed);
      expect(out.rows[srvIdx].collectionAmt).toBe(70);
      expect(out.shiftNotes).toBe(`mine ${seed}`);
      expect(out.cafeteriaRows).toHaveLength(1);
      expect(rebaseShiftRecord(base, base, fresh).rows).toEqual(fresh.rows);                  // من غير تعديل منّي: نسخة السيرفر زي ما هي
    }
  });

  it("إجماليات الحجز: الأونلاين بيحصّل الخدمات بس، والمتبقي مايبقاش سالب أبدًا", () => {
    for (let seed = 1; seed <= ITER; seed++) {
      const rnd = mulberry32(seed + 9);
      const b = { totalRoom: r2(rnd() * 1000), extras: { laundry: r2(rnd() * 50), cafeteria: r2(rnd() * 50), tours: r2(rnd() * 50), pickup: r2(rnd() * 50) }, earlyCheckin: { applied: rnd() < 0.5, fee: r2(rnd() * 60) }, paymentDetails: { onlinePaid: rnd() < 0.4 }, amountPaid: r2(rnd() * 1300) };
      const gt = bookingGrandTotal(b), ht = bookingHotelTotal(b);
      expect(ht).toBeLessThanOrEqual(gt + 1e-9);
      if (b.paymentDetails.onlinePaid) expect(near(ht, gt - b.totalRoom) || ht === 0).toBe(true); else expect(near(ht, gt)).toBe(true);
      expect(bookingAmountDue(b)).toBeGreaterThanOrEqual(0);
      expect(near(bookingAmountDue(b), Math.max(0, ht - b.amountPaid))).toBe(true);
    }
  });
});
