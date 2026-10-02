export const COMMON_CURRENCIES = ["EGP", "USD", "EUR", "SAR", "GBP"];
export const CURRENCY_LABEL = { EGP: "جنيه", USD: "دولار", EUR: "يورو", SAR: "ريال سعودي", GBP: "جنيه إسترليني" };
export const PAYMENT_METHODS = ["كاش", "فيزا", "انستاباي", "فودافون كاش", "تحويل بنكي"];
export const ONLINE_METHODS = ["فيزا", "انستاباي", "فودافون كاش", "تحويل بنكي"];
export const EXPENSE_CATEGORIES = ["كهرباء ومياه", "مشتريات ومطبخ", "صيانة", "مرتبات وحوافز", "نظافة", "أخرى"];
export const DEFAULT_ONLINE_COMMISSION_PCT = 15;

export const emptyMoney = () => ({});
/* كل عملة اتسجل ليها أي مبلغ (عهدة/تحصيل/مصاريف) في أي مكان في السجل - مش
   بس جنيه ودولار. بيتستخدم عشان نعرض كارت لكل عملة استُخدمت فعليًا بدل
   عمودين ثابتين. */
export function currencyKeysOf(...moneyObjects) {
  const set = new Set();
  moneyObjects.forEach((m) => { if (m && typeof m === "object") Object.keys(m).forEach((k) => { if (k) set.add(k); }); });
  return Array.from(set).sort((a, b) => (a === "EGP" ? -1 : b === "EGP" ? 1 : a === "USD" ? -1 : b === "USD" ? 1 : a.localeCompare(b)));
}
export const emptyPaymentDetails = () => ({ senderName: "", senderNumber: "", ref: "", onlinePaid: false, commissionPct: DEFAULT_ONLINE_COMMISSION_PCT });
export const emptyLedgerRow = (room) => ({
  room, expenseDesc: "", expenseAmt: "", expenseCategory: "أخرى", expenseCurrency: "EGP",
  collectionDesc: "", collectionAmt: "", collectionMethod: "كاش", collectionCurrency: "EGP",
  paymentDetails: emptyPaymentDetails(), notes: "",
});

/* المبلغ الصافي بعد خصم عمولة منصة الحجز الأونلاين (Booking.com وغيرها) */
export function onlineNetAmount(grossAmount, commissionPct) {
  const gross = Number(grossAmount) || 0;
  const pct = Number(commissionPct) || 0;
  return gross * (1 - pct / 100);
}


export function fmt(n) {
  return (Number(n) || 0).toLocaleString("ar-EG");
}

export function money(obj, cur) {
  return fmt(obj?.[cur] || 0);
}

export function freshShiftRecord(date, shiftKey, staffName, staffUsername, rooms, handover) {
  return {
    date, shiftKey, staffName, staffUsername, handover: (handover && Object.keys(handover).length > 0) ? handover : { EGP: 0 },
    rows: rooms.map((r) => emptyLedgerRow(r.number)),
    cafeteria: emptyLedgerRow("كافيتيريا"),
    shiftNotes: "", flagged: false, closed: false, closedBy: null, closedAt: null,
  };
}

export function computeShiftTotals(record) {
  const allRows = [...record.rows, { ...record.cafeteria, room: "كافيتيريا" }];
  const totalExpenses = emptyMoney(), totalCollections = emptyMoney(), cashCollections = emptyMoney();
  const byMethodCurrency = {}, byCategory = {};
  allRows.forEach((r) => {
    const exp = Number(r.expenseAmt) || 0;
    if (exp > 0) {
      const cur = r.expenseCurrency || "EGP";
      totalExpenses[cur] = (totalExpenses[cur] || 0) + exp;
      const cat = r.expenseCategory || "أخرى";
      byCategory[cat] = byCategory[cat] || emptyMoney();
      byCategory[cat][cur] = (byCategory[cat][cur] || 0) + exp;
    }
    const col = Number(r.collectionAmt) || 0;
    if (col > 0) {
      const cur = r.collectionCurrency || "EGP";
      totalCollections[cur] = (totalCollections[cur] || 0) + col;
      byMethodCurrency[r.collectionMethod] = byMethodCurrency[r.collectionMethod] || emptyMoney();
      byMethodCurrency[r.collectionMethod][cur] = (byMethodCurrency[r.collectionMethod][cur] || 0) + col;
      if (r.collectionMethod === "كاش") cashCollections[cur] = (cashCollections[cur] || 0) + col;
    }
  });
  const handover = record.handover && typeof record.handover === "object" ? record.handover : { EGP: Number(record.handover) || 0 };
  const closingCash = {};
  currencyKeysOf(handover, cashCollections, totalExpenses).forEach((cur) => {
    closingCash[cur] = (handover[cur] || 0) + (cashCollections[cur] || 0) - (totalExpenses[cur] || 0);
  });
  return { totalExpenses, totalCollections, cashCollections, byMethodCurrency, byCategory, closingCash };
}

/* تحصيل الحجوزات اللي اتدفعت مباشر (مش أونلاين) حسب طريقة الدفع والعملة.
   دي المبالغ اللي بتتسجل وقت "تسجيل تحصيل" على الحجز نفسه (فيزا/انستاباي/
   فودافون كاش/تحويل بنكي...) ومش بتمر على يومية الشيفت أبدًا - فمن غير
   الدالة دي كانت بتختفي من التقرير بالكامل. الكاش مستبعد عمدًا لأنه بيتسجل
   من اليومية نفسها (تسوية درج الكاش الفعلي)، فمحسبوش هنا منعًا للتكرار. */
export function directBookingPaymentsByMethod(bookings) {
  const byMethodCurrency = {};
  (bookings || []).forEach((b) => {
    if (b.paymentDetails?.onlinePaid) return;
    const paid = Number(b.amountPaid) || 0;
    if (paid <= 0) return;
    const method = b.paymentMethod || "كاش";
    if (method === "كاش") return;
    const cur = b.currency || "EGP";
    byMethodCurrency[method] = byMethodCurrency[method] || emptyMoney();
    byMethodCurrency[method][cur] = (byMethodCurrency[method][cur] || 0) + paid;
  });
  return byMethodCurrency;
}

export function bookingGrandTotal(b) {
  const extras = b.extras || {};
  const earlyFee = b.earlyCheckin?.applied ? Number(b.earlyCheckin.fee) || 0 : 0;
  return (Number(b.totalRoom) || 0) + (Number(extras.laundry) || 0) + (Number(extras.cafeteria) || 0) + (Number(extras.tours) || 0) + (Number(extras.pickup) || 0) + earlyFee;
}
