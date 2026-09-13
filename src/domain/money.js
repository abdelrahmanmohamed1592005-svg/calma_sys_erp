export const CURRENCIES = ["EGP", "USD"];
export const CURRENCY_LABEL = { EGP: "جنيه", USD: "دولار" };
export const PAYMENT_METHODS = ["كاش", "فيزا", "انستاباي", "فودافون كاش", "تحويل بنكي"];
export const ONLINE_METHODS = ["فيزا", "انستاباي", "فودافون كاش", "تحويل بنكي"];
export const EXPENSE_CATEGORIES = ["كهرباء ومياه", "مشتريات ومطبخ", "صيانة", "مرتبات وحوافز", "نظافة", "أخرى"];

export const emptyMoney = () => ({ EGP: 0, USD: 0 });
export const emptyPaymentDetails = () => ({ senderName: "", senderNumber: "", ref: "" });
export const emptyLedgerRow = (room) => ({
  room, expenseDesc: "", expenseAmt: "", expenseCategory: "أخرى", expenseCurrency: "EGP",
  collectionDesc: "", collectionAmt: "", collectionMethod: "كاش", collectionCurrency: "EGP",
  paymentDetails: emptyPaymentDetails(), notes: "",
});

export function fmt(n) {
  return (Number(n) || 0).toLocaleString("ar-EG");
}

export function money(obj, cur) {
  return fmt(obj?.[cur] || 0);
}

export function freshShiftRecord(date, shiftKey, staffName, staffUsername, rooms, handover) {
  return {
    date, shiftKey, staffName, staffUsername, handover: handover || emptyMoney(),
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
  const handover = record.handover && typeof record.handover === "object" ? record.handover : { EGP: Number(record.handover) || 0, USD: 0 };
  const closingCash = {
    EGP: (handover.EGP || 0) + (cashCollections.EGP || 0) - (totalExpenses.EGP || 0),
    USD: (handover.USD || 0) + (cashCollections.USD || 0) - (totalExpenses.USD || 0),
  };
  return { totalExpenses, totalCollections, cashCollections, byMethodCurrency, byCategory, closingCash };
}

export function bookingGrandTotal(b) {
  const extras = b.extras || {};
  const earlyFee = b.earlyCheckin?.applied ? Number(b.earlyCheckin.fee) || 0 : 0;
  return (Number(b.totalRoom) || 0) + (Number(extras.laundry) || 0) + (Number(extras.cafeteria) || 0) + (Number(extras.tours) || 0) + (Number(extras.pickup) || 0) + earlyFee;
}
