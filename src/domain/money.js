// العملات دي بس اللي النظام بيتعامل بيها - مثبّتة في قوائم اختيار في كل
// مكان فيه عملة (مش نص حر تاني)، ونفس الخمسة مقيّدة في قاعدة البيانات
// (bookings_currency_chk في schema.sql).
export const COMMON_CURRENCIES = ["EGP", "USD", "EUR", "SAR", "GBP"];
export const CURRENCY_LABEL = { EGP: "جنيه", USD: "دولار", EUR: "يورو", SAR: "ريال سعودي", GBP: "جنيه إسترليني" };
// "انستاباي" و"تحويل بنكي" وسيلة واحدة فعليًا (انستاباي هو تحويل بنكي) -
// دمجناهم في خيار واحد بدل ما يظهروا كاختيارين مختلفين. لو فيه حجوزات/شيفتات
// قديمة مسجلة بأي من الاسمين القديمين لوحده، تفضل تتعرض بنص القيمة المحفوظة
// زي ما هي (مش نص حر مقيّد في قاعدة البيانات)، بس أي اختيار جديد من دلوقتي
// هيكون بالاسم المدمج ده بس.
export const PAYMENT_METHODS = ["كاش", "فيزا", "تحويل بنكي / انستاباي", "فودافون كاش"];
// لازم نفضل نتعرف على الاسمين القديمين (قبل الدمج) في حجوزات/شيفتات قديمة
// فعلاً مسجلة بيهم، عشان قسم "تفاصيل التحويل المباشر" ميختفيش منها.
export const ONLINE_METHODS = ["فيزا", "تحويل بنكي / انستاباي", "فودافون كاش", "انستاباي", "تحويل بنكي"];

/* قائمة اختيار وسيلة الدفع اللي تعرض القيمة المحفوظة فعليًا حتى لو كانت
   باسم قديم (قبل دمج انستاباي/تحويل بنكي) مش موجود في PAYMENT_METHODS
   الجديدة - من غيرها الـ <select> هيعرض فاضي لحجز/صف قديم من غير ما يغيّر
   القيمة المحفوظة فعليًا. */
export function methodOptionsFor(currentValue) {
  return currentValue && !PAYMENT_METHODS.includes(currentValue) ? [...PAYMENT_METHODS, currentValue] : PAYMENT_METHODS;
}
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

export function freshShiftRecord(date, shiftKey, staffName, staffUsername, rooms, handover, methodHandover) {
  return {
    date, shiftKey, staffName, staffUsername, handover: (handover && Object.keys(handover).length > 0) ? handover : { EGP: 0 },
    // عهدة وسائل الدفع التانية غير الكاش (فيزا/انستاباي/فودافون كاش/تحويل
    // بنكي...) - زي عهدة الكاش بالظبط، بس دي بتمثل قراءة جهاز الدفع (مثلاً)
    // في بداية الشيفت، بتتنقل تلقائيًا من رصيد إقفال الشيفت اللي فات.
    // الشكل: { "فيزا": { "EGP": 12000 }, ... }
    methodHandover: (methodHandover && Object.keys(methodHandover).length > 0) ? methodHandover : {},
    rows: rooms.map((r) => emptyLedgerRow(r.number)),
    cafeteria: emptyLedgerRow("كافيتيريا"),
    // سجل داخلي بس (مش بيظهر في أي شاشة) بيحفظ أرقام الحجوزات اللي تحصيلها
    // اتضاف فعليًا لصف غرفتها في rows فوق (عن طريق appendBookingCollection في
    // data/shifts.js) - كل عنصر {id, bookingId}. الهدف الوحيد منه إن تقرير
    // "تحصيل الحجوزات بطرق الدفع الأخرى" في ReportsPanel.jsx مايحسبش نفس
    // المبلغ مرتين (مرة من rows هنا، ومرة تاني من amountPaid على الحجز نفسه).
    // التحصيل الفعلي نفسه موجود في خانة "التحصيل" العادية لصف الغرفة بالظبط
    // زي ما لو الموظف كتبها بإيده - مفيش جدول تاني مستقل.
    bookingCollections: [],
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
    // col ممكن يكون سالب دلوقتي (رد فلوس حجز ملغي بيتسجل في نفس الخانة دي -
    // انظر appendBookingCollection في data/shifts.js) - عشان كده الشرط بقى
    // "!= 0" مش "> 0"، ونفس الخانة بتدخل في إجمالي التحصيل ورصيد الخزينة
    // (لو كاش) سواء كانت تحصيل أو رد فلوس.
    const col = Number(r.collectionAmt) || 0;
    if (col !== 0) {
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
  // رصيد كل وسيلة دفع تانية (غير الكاش) دلوقتي = العهدة في بداية الشيفت +
  // اللي اتحصّل بنفس الوسيلة والعملة خلال الشيفت ده. مفيش مصاريف بتتخصم هنا
  // لأن المصاريف بتتدفع كاش عادةً، مش من جهاز الدفع.
  const methodHandover = record.methodHandover && typeof record.methodHandover === "object" ? record.methodHandover : {};
  const methodClosing = {};
  const methods = new Set([...Object.keys(methodHandover), ...Object.keys(byMethodCurrency)]);
  methods.forEach((m) => {
    if (m === "كاش") return;
    methodClosing[m] = emptyMoney();
    currencyKeysOf(methodHandover[m], byMethodCurrency[m]).forEach((cur) => {
      methodClosing[m][cur] = (methodHandover[m]?.[cur] || 0) + (byMethodCurrency[m]?.[cur] || 0);
    });
  });
  return { totalExpenses, totalCollections, cashCollections, byMethodCurrency, byCategory, closingCash, methodHandover, methodClosing };
}

/* تحصيل الحجوزات اللي اتدفعت مباشر (مش أونلاين) حسب طريقة الدفع والعملة.
   دي المبالغ اللي بتتسجل وقت "تسجيل تحصيل" على الحجز نفسه (فيزا/انستاباي/
   فودافون كاش/تحويل بنكي...) ومش بتمر على يومية الشيفت أبدًا - فمن غير
   الدالة دي كانت بتختفي من التقرير بالكامل. الكاش مستبعد عمدًا لأنه بيتسجل
   من اليومية نفسها (تسوية درج الكاش الفعلي)، فمحسبوش هنا منعًا للتكرار. */
// journaledIds: مجموعة (Set) بأرقام الحجوزات اللي تحصيلها اتسجل فعليًا في
// يومية شيفت (bookingCollections - انظر computeShiftTotals فوق) ضمن
// السجلات اللي التقرير شايفها دلوقتي. من غيرها كنا هنحسب نفس المبلغ مرتين:
// مرة من اليومية (byMethodCurrency في aggregateShifts) ومرة تاني هنا من قيمة
// amountPaid على الحجز نفسها. أي حجز معاه في المجموعة دي بنتجاهله هنا تمامًا.
export function directBookingPaymentsByMethod(bookings, journaledIds) {
  const byMethodCurrency = {};
  (bookings || []).forEach((b) => {
    if (b.paymentDetails?.onlinePaid) return;
    if (journaledIds && journaledIds.has(b.id)) return;
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
