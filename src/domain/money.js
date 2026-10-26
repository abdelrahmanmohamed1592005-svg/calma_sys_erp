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

export const HOTEL_ROW_LABEL = "فندق";
export const emptyMoney = () => ({});
/* كل عملة اتسجل ليها أي مبلغ (عهدة/تحصيل/مصاريف) في أي مكان في السجل - مش
   بس جنيه ودولار. بيتستخدم عشان نعرض كارت لكل عملة استُخدمت فعليًا بدل
   عمودين ثابتين. */
export function currencyKeysOf(...moneyObjects) {
  const set = new Set();
  moneyObjects.forEach((m) => { if (m && typeof m === "object") Object.keys(m).forEach((k) => { if (k) set.add(k); }); });
  return Array.from(set).sort((a, b) => (a === "EGP" ? -1 : b === "EGP" ? 1 : a === "USD" ? -1 : b === "USD" ? 1 : a.localeCompare(b)));
}
export const emptyPaymentDetails = () => ({ senderName: "", senderNumber: "", ref: "", onlinePaid: false });

/* تفاصيل الدفع المطلوبة لكل وسيلة (مفيش "رقم عملية" ولا "اسم صاحب الكارت" تاني):
   - فيزا: آخر ٤ أرقام الكارت بس (بتتخزّن في senderNumber).
   - فودافون كاش / انستاباي / تحويل بنكي: اسم المرسل + رقم التليفون.
   - الكاش: مفيش تفاصيل.
   نفس الشكل (senderName/senderNumber) اللي كان متخزن قبل كده، فمفيش تغيير في
   قاعدة البيانات، والبيانات القديمة بتتعرض زي ما هي. */
export const isVisaMethod = (m) => m === "فيزا";
export const isTransferMethod = (m) => ONLINE_METHODS.includes(m) && m !== "فيزا";
const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";
/* كل الأرقام في السيستم (فلوس، تواريخ، عدد) بالأرقام اللاتيني 0-9 - نفس اللي الموظف بيكتبه في الخانات */
export const NUM_LOCALE = "en-US";
export function toLatinDigits(v) { return String(v ?? "").replace(/[٠-٩]/g, (d) => String(ARABIC_DIGITS.indexOf(d))); }
export function normalizeLast4(v) { return toLatinDigits(v).replace(/\D/g, "").slice(-4); }
export function normalizePhone(v) { return toLatinDigits(v).replace(/[^\d+]/g, "").slice(0, 20); }
const clip = (v, n) => String(v ?? "").replace(/[\u0000-\u001F\u007F]/g, "").trim().slice(0, n);

/* بتنضّف تفاصيل الدفع حسب الوسيلة وبترجّع الشكل الثابت (من غير أي خانة زيادة) */
export function cleanPaymentDetailsFor(method, d) {
  const base = emptyPaymentDetails();
  if (isVisaMethod(method)) return { ...base, senderNumber: normalizeLast4(d?.senderNumber) };
  if (isTransferMethod(method)) return { ...base, senderName: clip(d?.senderName, 120), senderNumber: normalizePhone(d?.senderNumber) };
  return base;
}
/* رسالة خطأ (نص) لو التفاصيل ناقصة/غلط لوسيلة الدفع دي، أو "" لو سليمة */
export function validatePaymentDetailsFor(method, d) {
  if (isVisaMethod(method)) return normalizeLast4(d?.senderNumber).length === 4 ? "" : "اكتب آخر 4 أرقام من الكارت (4 أرقام بالظبط)";
  if (isTransferMethod(method)) return normalizePhone(d?.senderNumber).replace(/\D/g, "").length >= 6 ? "" : "اكتب رقم التليفون اللي اتحوّل منه";
  return "";
}
/* نص مختصر لتفاصيل الدفع بيتعرض في اليومية والتقارير: ****1234 أو "الاسم · الرقم" */
export function describePaymentDetails(method, d) {
  if (!d) return "";
  if (isVisaMethod(method)) { const n = normalizeLast4(d.senderNumber); return n ? `****${n}` : ""; }
  if (ONLINE_METHODS.includes(method)) return [d.senderName, d.senderNumber].map((x) => String(x || "").trim()).filter(Boolean).join(" · ");
  return "";
}
/* تفاصيل متطابقة؟ (بتفرّق بين كارتين أو محفظتين مختلفتين عشان ماتتدمجش في صف واحد) */
export function sameDetails(method, a, b) {
  if (!ONLINE_METHODS.includes(method)) return true;
  return describePaymentDetails(method, a) === describePaymentDetails(method, b);
}
export const emptyLedgerRow = (room) => ({
  room, expenseDesc: "", expenseAmt: "", expenseCategory: "أخرى", expenseCurrency: "EGP",
  collectionDesc: "", collectionAmt: "", collectionMethod: "كاش", collectionCurrency: "EGP",
  paymentDetails: emptyPaymentDetails(), notes: "",
});

export function fmt(n) {
  return (Number(n) || 0).toLocaleString(NUM_LOCALE);
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
    // تحصيل الكافيتيريا التلقائي: خدمات الكافيتيريا اللي اتحصّلت من نزلاء (من
    // بلوك الغرف/الحجوزات) وسداد الاستاف لمشروباتهم/أكلهم - كل بند صف بنفس
    // شكل صف اليومية، بيدخل في إجمالي التحصيل وطرق الدفع وعهدة الفيزا.
    cafeteriaRows: [],
    // بنود "مصاريف وإيرادات الفندق": مش مرتبطة بغرفة (كهرباء، إيجار قاعة، مشتريات...) - الموظف
    // بيضيف منها بنود حسب الحاجة، وبتدخل في إجماليات اليومية والتقارير زي باقي الصفوف.
    hotelRows: [emptyLedgerRow(HOTEL_ROW_LABEL)],
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

/* بتضيف تحصيل (أو رد فلوس - amount سالب) حجز على صفوف اليومية العادية من
   غير ما تخلط وسائل دفع أو عملات مختلفة في نفس الخانة (صف الغرفة الواحد ليه
   وسيلة دفع وعملة واحدة بس):
   1) صف لنفس الغرفة بنفس وسيلة الدفع ونفس العملة => المبلغ بيتجمع عليه.
   2) لو مفيش، صف لنفس الغرفة فاضي تمامًا (من غير مبلغ ولا بيان) => بيتستخدم.
   3) لو مفيش، بنضيف صف جديد لنفس الغرفة في نفس الجدول (مش جدول تاني).
   بتتجاهل المبالغ الصفرية. بترجّع الصفوف الجديدة بس (من غير تعديل الأصل). */
export function applyCollectionToRows(rows, entry) {
  const amount = Number(entry.amount) || 0;
  if (amount === 0) return { rows, added: false };
  const label = `${entry.note || "تحصيل"}${entry.guestName ? " - " + entry.guestName : ""} (${amount > 0 ? "+" : ""}${amount} ${entry.currency})`;
  const isEmptyRow = (r) => (Number(r.collectionAmt) || 0) === 0 && !r.collectionDesc;
  const bid = entry.bookingId || null;
  // تفاصيل الدفع (آخر ٤ أرقام الفيزا / اسم ورقم المحوِّل) بتتنقل مع التحصيل لصف
  // اليومية نفسه - وكارتين أو محفظتين مختلفتين مابيتدمجوش في صف واحد.
  const details = entry.details ? { ...emptyPaymentDetails(), ...entry.details } : null;
  const sameMethod = (r) => r.collectionMethod === entry.method && r.collectionCurrency === entry.currency && (!details || sameDetails(entry.method, r.paymentDetails, details));
  // تحصيل كل حجز بيتسجّل في صف مستقل بتاعه (bookingId) - فتحصيل التسكين المكرر مابيتدمجش
  // مع تحصيل الحجز اللي كان قبله على نفس الغرفة، وبيبان لوحده في اليومية.
  let idx = -1;
  if (bid) idx = rows.findIndex((r) => r.room === entry.room && r.bookingId === bid && !isEmptyRow(r) && sameMethod(r));
  // من غير bookingId (تحصيل قديم/يدوي): السلوك القديم - بيتجمّع مع صف الغرفة بنفس الوسيلة والعملة
  else idx = rows.findIndex((r) => r.room === entry.room && !isEmptyRow(r) && sameMethod(r));
  if (idx === -1) idx = rows.findIndex((r) => r.room === entry.room && isEmptyRow(r) && !r.bookingId);
  const out = rows.slice();
  if (idx === -1) {
    out.push({ ...emptyLedgerRow(entry.room), ...(bid ? { bookingId: bid } : {}), collectionAmt: Math.round(amount * 100) / 100, collectionMethod: entry.method, collectionCurrency: entry.currency, collectionDesc: label, ...(details ? { paymentDetails: details } : {}) });
    return { rows: out, added: true };
  }
  const r = rows[idx];
  const wasEmpty = isEmptyRow(r);
  out[idx] = {
    ...r,
    ...(bid && !r.bookingId ? { bookingId: bid } : {}),
    collectionAmt: Math.round(((Number(r.collectionAmt) || 0) + amount) * 100) / 100,      // تقريب لخانتين (من غير 175.04000000000002)
    collectionMethod: entry.method,
    collectionCurrency: entry.currency,
    collectionDesc: r.collectionDesc ? `${r.collectionDesc} / ${label}` : label,
    ...(details && wasEmpty ? { paymentDetails: details } : {}),
  };
  return { rows: out, added: false };
}

/* تحصيل الكافيتيريا التلقائي (cafeteriaRows): كل صف بنفس شكل صف اليومية، وبيتعلّم
   بنوعه: kind = "guest" (خدمة كافيتيريا اتحصّلت من نزيل - مربوطة بالحجز) أو
   "staff" (استاف سدّد مشروباته/أكله). نفس الجهة + الوسيلة + العملة + التفاصيل
   بيتجمّعوا في صف واحد، وغير كده بيتضاف صف جديد (من غير ما نخلط وسايل دفع). */
export const CAFETERIA_ROW_LABEL = "كافيتيريا";
export function applyCafeteriaCollection(cafeteriaRows, entry) {
  const amount = Number(entry.amount) || 0;
  const list = cafeteriaRows || [];
  if (amount === 0) return { rows: list, added: false };
  const kind = entry.kind === "staff" ? "staff" : "guest";
  const key = kind === "staff" ? (entry.consumerKey || "") : (entry.bookingId || "");
  const details = entry.details ? { ...emptyPaymentDetails(), ...entry.details } : emptyPaymentDetails();
  const label = `${entry.note || "كافيتيريا"}${entry.who ? " - " + entry.who : ""} (${amount > 0 ? "+" : ""}${amount} ${entry.currency})`;
  const rowKey = (r) => (r.kind === "staff" ? (r.consumerKey || "") : (r.bookingId || ""));
  const idx = list.findIndex((r) => (r.kind || "guest") === kind && rowKey(r) === key && r.collectionMethod === entry.method && r.collectionCurrency === entry.currency && sameDetails(entry.method, r.paymentDetails, details));
  const out = list.slice();
  if (idx === -1) {
    out.push({
      ...emptyLedgerRow(CAFETERIA_ROW_LABEL), kind, ...(kind === "staff" ? { consumerKey: key } : { bookingId: key || undefined, guestRoom: entry.room }),
      who: entry.who || "", collectionAmt: amount, collectionMethod: entry.method, collectionCurrency: entry.currency, collectionDesc: label, paymentDetails: details,
    });
    return { rows: out, added: true };
  }
  const r = list[idx];
  out[idx] = { ...r, collectionAmt: Math.round(((Number(r.collectionAmt) || 0) + amount) * 100) / 100, collectionDesc: r.collectionDesc ? `${r.collectionDesc} / ${label}` : label };
  return { rows: out, added: false };
}

/* توزيع دفعة على حجز: الأول بتسدّد خدمات الكافيتيريا اللي لسه عليه (extras.cafeteria
   ناقص اللي اتسدّد منها extras.cafeteriaPaid)، والباقي لسعر الغرفة/باقي الرسوم.
   الجزء الأول بيروح لصف الكافيتيريا في اليومية تلقائيًا والتاني لصف الغرفة. */
export function splitPaymentForCafeteria(booking, amount) {
  const amt = Number(amount) || 0;
  if (amt <= 0) return { cafeteria: 0, rest: amt };
  const ex = booking?.extras || {};
  const outstanding = Math.max(0, (Number(ex.cafeteria) || 0) - (Number(ex.cafeteriaPaid) || 0));
  const cafeteria = Math.round(Math.min(amt, outstanding) * 100) / 100;
  return { cafeteria, rest: Math.round((amt - cafeteria) * 100) / 100 };       // تقريب لخانتين: مفيش كسور عشرية عائمة (6.199999...) في المبالغ
}
export function cafeteriaOutstanding(booking) {
  const ex = booking?.extras || {};
  return Math.max(0, (Number(ex.cafeteria) || 0) - (Number(ex.cafeteriaPaid) || 0));
}

/* صفوف تحصيل (موجبة) بفيزا من غير آخر ٤ أرقام، أو بتحويل/فودافون من غير رقم - لازم
   تتكمّل قبل إقفال الشيفت عشان كل عملية تتتبّع. رد الفلوس (سالب) مستثنى. */
export function missingPaymentDetails(record) {
  const out = [];
  const check = (r, where) => {
    if ((Number(r.collectionAmt) || 0) <= 0) return;
    if (validatePaymentDetailsFor(r.collectionMethod, r.paymentDetails)) out.push({ where, method: r.collectionMethod });
  };
  (record.rows || []).forEach((r) => check(r, `غرفة ${r.room}`));
  check(record.cafeteria || {}, "كافيتيريا");
  (record.cafeteriaRows || []).forEach((r) => check(r, "كافيتيريا"));
  (record.hotelRows || []).forEach((r) => check(r, "فندق"));
  return out;
}

/* كل عمليات وسيلة دفع (غير الكاش) في سجل شيفت - بتتعرض في متابعة العهدة
   (فيزا: ****1234، تحويل: اسم · رقم) عشان كل تحصيل يبان بتفاصيله كاملة. */
export function methodTransactions(record, method) {
  const out = [];
  const take = (r, where) => {
    const amt = Number(r.collectionAmt) || 0;
    if (amt === 0 || r.collectionMethod !== method) return;
    out.push({ where, label: r.collectionDesc || "", amount: amt, currency: r.collectionCurrency || "EGP", details: describePaymentDetails(method, r.paymentDetails) });
  };
  (record.rows || []).forEach((r) => take(r, `غرفة ${r.room}`));
  take({ ...(record.cafeteria || {}) }, "كافيتيريا");
  (record.cafeteriaRows || []).forEach((r) => take(r, "كافيتيريا"));
  (record.hotelRows || []).forEach((r) => take(r, "فندق"));
  return out;
}

export function computeShiftTotals(record) {
  const allRows = [...record.rows, { ...record.cafeteria, room: "كافيتيريا" }, ...(record.cafeteriaRows || []), ...(record.hotelRows || [])];
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
  // تقريب كل المبالغ لقرشين: مجموع أعداد عشرية بيطلّع بقايا زي 75.02999999999999 كانت بتتخزّن وتتنقل كعهدة للشيفت اللي بعده
  const rnd = (o) => { Object.keys(o).forEach((k) => { if (typeof o[k] === "number") o[k] = Math.round(o[k] * 100) / 100; else if (o[k] && typeof o[k] === "object") rnd(o[k]); }); return o; };
  [totalExpenses, totalCollections, cashCollections, byMethodCurrency, byCategory, closingCash, methodClosing].forEach(rnd);
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

/* اللي الفندق نفسه مطلوب يحصّله من النزيل (وده اللي بيدخل اليومية والتقرير والتوتال):
   - حجز عادي: الإجمالي الكلي (غرفة + خدمات + دخول مبكر).
   - حجز مدفوع أونلاين: سعر الغرفة اتدفع للمنصة، فالفندق بيحصّل بس الخدمات الإضافية
     والدخول المبكر (الإجمالي - سعر الغرفة). amountPaid في الحالتين = اللي الفندق حصّله فعلاً. */
/* سعر الغرفة اللي اتدفع أونلاين: المنصة دفعت سعر الغرفة اللي اتحجز بس - الرسوم والدخول المبكر وليالي التمديد
   في الفندق بتتحصّل في الفندق (onlineRoomAmount؛ لو مش موجود = إجمالي الغرفة). نفس booking_hotel_total في القاعدة. */
export function onlineRoomCovered(b) {
  const room = Number(b?.totalRoom) || 0;
  const pd = b?.paymentDetails || {};
  if (!pd.onlinePaid) return 0;
  return pd.onlineRoomAmount != null && pd.onlineRoomAmount !== "" ? Math.min(room, Number(pd.onlineRoomAmount) || 0) : room;
}
export function bookingHotelTotal(b) {
  const gt = bookingGrandTotal(b);
  return b.paymentDetails?.onlinePaid ? Math.max(0, gt - onlineRoomCovered(b)) : gt;
}
export function bookingAmountDue(b) {
  return Math.max(0, bookingHotelTotal(b) - (Number(b.amountPaid) || 0));
}

/* المبلغ المطلوب رده للنزيل لو فيه طلب رد فلوس معلّق (refundPending):
   حجز ملغي => كل المدفوع، حجز لسه شغال/خرج بدري => الزيادة عن الإجمالي بس.
   نفس حساب decide_booking_refund في قاعدة البيانات بالظبط. */
export function refundDueAmount(b) {
  if (!b || !b.refundPending) return 0;
  const paid = Number(b.amountPaid) || 0;
  if (b.status === "ملغي") return Math.max(0, paid);
  return Math.max(0, paid - bookingGrandTotal(b));
}

/* لما موظف الشيفت بيكتب في اليومية وفي نفس اللحظة تعديل تاني اتكتب على نفس
   السجل (رد فلوس من مدير الحجوزات، أو تحصيل حجز من شاشة تانية) - بدل ما تعديلاته
   تضيع، بنطبّق بس الخانات اللي هو غيّرها فعلاً (مقارنة بنسخته الأصلية base)
   فوق آخر نسخة من السيرفر (fresh). خانة هو ما لمسهاش بتتاخد من السيرفر زي ما هي. */
export function rebaseShiftRecord(base, mine, fresh) {
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const skip = new Set(["rows", "hotelRows", "cafeteriaRows", "bookingCollections", "updatedAt", "closed", "closedBy", "closedAt"]);
  const out = { ...fresh };
  Object.keys(mine).forEach((k) => { if (!skip.has(k) && !same(mine[k], base?.[k])) out[k] = mine[k]; });
  // الصفوف (الغرف وبنود الفندق): نطبّق بس الخانات اللي الموظف غيّرها فعلاً فوق نسخة السيرفر
  const r2 = (n) => Math.round(n * 100) / 100;
  const mergeRows = (baseRows, mineRows, freshRows, { structural = false } = {}) => {
    // بند اتمسح/اتضاف عند الموظف (طول مختلف عن النسخة الأصلية): المطابقة بالمكان بتبوّظ (بند بيتكرر وبند بيتمسح ويرجع)،
    // وبنود الفندق بيكتبها الموظف نفسه بس - فنسخته هي الصح
    if (structural && (mineRows || []).length !== (baseRows || []).length) return (mineRows || []).slice();
    const rows = (freshRows || []).slice();
    (mineRows || []).forEach((row, i) => {
      const b = baseRows?.[i];
      if (!b) { rows.push(row); return; }
      if (!rows[i] || same(row, b)) return;
      const merged = { ...rows[i] };
      Object.keys(row).forEach((k) => {
        if (same(row[k], b[k])) return;
        // الموظف كتب مبلغ تحصيل في خانة والسيرفر زوّد تحصيل حجز في نفس الخانة: بنجمع الاتنين (مش الأحدث يمسح التاني)
        if (k === "collectionAmt" && !same(rows[i][k], b[k])) {
          merged[k] = r2((Number(rows[i][k]) || 0) + ((Number(row[k]) || 0) - (Number(b[k]) || 0)));
          return;
        }
        merged[k] = row[k];
      });
      rows[i] = merged;
    });
    return rows;
  };
  out.rows = mergeRows(base?.rows, mine.rows, fresh.rows);
  out.hotelRows = mergeRows(base?.hotelRows, mine.hotelRows, fresh.hotelRows, { structural: true });
  out.cafeteriaRows = mergeRows(base?.cafeteriaRows, mine.cafeteriaRows, fresh.cafeteriaRows);
  return out;
}

/* حالة الفلوس لحجز ملغي (أو اترد منه فلوس) بنص واضح - بتظهر دايمًا في قائمة الحجوزات:
   kind = pending | refunded | kept | holding | none. بترجّع null لحجز شغال ماحصلش فيه رد. */
export function refundStatusOf(b) {
  if (!b) return null;
  const paid = Number(b.amountPaid) || 0;
  const cur = b.currency || "";
  const fmtN = (n) => (Number(n) || 0).toLocaleString(NUM_LOCALE);
  if (b.refundPending && refundDueAmount(b) > 0) return { kind: "pending", text: `طلب رد فلوس معلّق: ${fmtN(refundDueAmount(b))} ${cur} - منتظر قرار مدير الحجوزات` };
  if (b.refundDecision === "refunded" && Number(b.refundedAmount) > 0) return { kind: "refunded", text: `اترد للنزيل ${fmtN(b.refundedAmount)} ${cur}${b.refundedBy ? " (بواسطة " + b.refundedBy + ")" : ""}` };
  if (b.status !== "ملغي") return null;
  if (paid > 0) return { kind: "kept", text: `ملغي - الـ ${fmtN(paid)} ${cur} المتحصّلة فضلت في الفندق` };
  return { kind: "none", text: "ملغي من غير فلوس متحصّلة" };
}
