/*
  تقرير الأونر: نفس ورق اليومية اللي كان بيتكتب بالإيد ويتصوّر - بس طالع من السيستم:
   1) "كشف الغرف": صف لكل غرفة (رقم النزيل، السعر × المدة، دخول، خروج، خدمات، إجمالي، مدفوع، كام ليلة مدفوعة، متبقي، التسكين).
   2) "ورقة الشيفت": لكل شيفت في اليوم (الغرفة / التحصيل / المصاريف) + العهدة وإجمالي التحصيل والمصاريف ورصيد الخزينة والفيزا/انستاباي/فودافون/عملة.
  الملف ده بيبني "نموذج ورقة" بس (نص وأرقام، من غير أي واجهة) - نفس النموذج بيتعرض على الشاشة، بيتطبع، وبيترسم صورة تتبعت واتساب.
  شكل الورقة: { id, title, head:[[عنوان, قيمة]], columns:[{key,label,w,align}], rows:[{cells:{key:[سطور]}, tone}], summary:[[عنوان, قيمة]], notes:[نص] }
*/
import { SHIFTS, roomDisplay } from "./constants";
import { arabicWeekday, nightsBetween } from "./dates";
import { roomStart, guestCodeEntries } from "./bookingLogic";
import { fmt, currencyKeysOf, computeShiftTotals, bookingGrandTotal, bookingDueLines, otherTotals, otherPaidOf, onlineRoomCovered, describePaymentDetails, EXTRA_KEYS } from "./money";

const EXTRA_LABEL = { laundry: "غسيل", cafeteria: "كافيتيريا", tours: "جولات", pickup: "بيك أب" };
const VISA = ["فيزا"], TRANSFER = ["تحويل بنكي / انستاباي", "انستاباي", "تحويل بنكي"], VODAFONE = ["فودافون كاش"];

/* 2026-11-13 => 13/11 (يوم/شهر - زي ما بيتكتب في الورق) */
export const dayMonth = (d) => { const p = String(d || "").split("-"); return p.length === 3 ? `${Number(p[2])}/${Number(p[1])}` : ""; };
/* { EGP: 500, USD: 20 } => "500 EGP + 20 USD" (الأصفار بتتشال، ولو مفيش حاجة "0") */
export function moneyText(obj) {
  const parts = currencyKeysOf(obj).filter((c) => Math.abs(Number(obj[c]) || 0) > 0.004).map((c) => amt(obj[c], c));
  return parts.length ? parts.join(" + ") : "0";
}
/* نص لاتيني/أرقام جوه سطر عربي: بيتعزل عشان ترتيبه مايتقلبش ("606 (T)(W)" ، "****1234") */
export const ltr = (s) => (s ? `\u2066${s}\u2069` : "");
/* مبلغ بعملته - دايمًا بنفس الترتيب "3,200 EGP" جوه أي سطر عربي */
export const amt = (n, cur) => ltr(`${fmt(n)}${cur ? " " + cur : ""}`);
export const stripMarks = (s) => String(s ?? "").replace(/[\u2066-\u2069]/g, "");
const isoDetails = (d) => String(d || "").split(" ").map((w) => (/[\d*]/.test(w) ? ltr(w) : w)).join(" ");
const roomText = (rooms, number) => { const { ltr: code, word } = roomDisplay(rooms, number); return [ltr(code), word].filter(Boolean); };
const sumInto = (acc, cur, n) => { if (Math.abs(n) > 0.004) acc[cur] = Math.round(((acc[cur] || 0) + n) * 100) / 100; };

/* حجوزات الغرفة في يوم الورقة: اللي خارج النهارده الأول، وبعده الساكن الليلة (ممكن الاتنين في نفس اليوم) */
export function bookingsForDay(bookings, room, date) {
  const live = (bookings || []).filter((b) => b.room === room && b.status !== "ملغي");
  const leaving = live.filter((b) => b.checkout === date && roomStart(b) <= date);
  const staying = live.filter((b) => roomStart(b) <= date && date < b.checkout);
  return [...leaving, ...staying];
}

/* دفع كام ليلة: المدفوع (بعد ما يسدّد الكافيتيريا) ÷ متوسط سعر الليلة. المدفوع أونلاين محسوب مدفوع. */
export function paidNights(b) {
  const nights = Math.max(1, nightsBetween(b.checkin, b.checkout));
  const room = Number(b.totalRoom) || 0;
  if (room <= 0) return { paid: nights, nights };
  const paidHere = Math.max(0, (Number(b.amountPaid) || 0) - Math.max(0, Number(b.extras?.cafeteriaPaid) || 0));
  const toward = Math.min(room, onlineRoomCovered(b) + paidHere);
  return { paid: Math.min(nights, Math.floor(toward / (room / nights) + 1e-6)), nights };
}

function servicesLines(b) {
  const lines = [];
  const cur = b.currency || "";
  EXTRA_KEYS.forEach((k) => { const v = Number(b.extras?.[k]) || 0; if (v > 0) lines.push(`${EXTRA_LABEL[k]} ${amt(v, cur)}`); });
  if (b.earlyCheckin?.applied && Number(b.earlyCheckin.fee) > 0) lines.push(`دخول مبكر ${amt(b.earlyCheckin.fee, cur)}`);
  Object.entries(b.otherCharges || {}).forEach(([c, ch]) => EXTRA_KEYS.forEach((k) => { const v = Number(ch?.[k]) || 0; if (v > 0) lines.push(`${EXTRA_LABEL[k]} ${amt(v, c)}`); }));
  return lines;
}

function paidLines(b, payments) {
  const lines = [];
  const online = !!b.paymentDetails?.onlinePaid;
  const paid = Number(b.amountPaid) || 0;
  if (online) lines.push("الغرفة مدفوعة أونلاين");
  if (paid > 0 || !online) lines.push(amt(paid, b.currency));
  Object.entries(otherPaidOf(b)).forEach(([c, v]) => lines.push(amt(v, c)));
  // تفاصيل الدفع من اليومية نفسها: كل وسيلة بمبلغها (كاش 1,261 / فيزا 6,245 ****1234)
  (payments || []).forEach((p) => {
    const d = describePaymentDetails(p.method, p.details);
    lines.push(`${p.method} ${amt(p.fx ? p.fx.amount : p.amount, p.fx ? p.fx.currency : p.currency && p.currency !== b.currency ? p.currency : "")}${d ? " " + isoDetails(d) : ""}`);
  });
  if (!payments?.length && paid > 0 && b.paymentMethod) lines.push(b.paymentMethod);
  return lines;
}

export function buildRoomsSheet({ rooms, bookings, date, paymentsIndex, hotelName }) {
  const columns = [
    { key: "room", label: "رقم الغرفة", w: 1.2 }, { key: "guest", label: "رقم النزيل", w: 1.3 }, { key: "price", label: "السعر × المدة", w: 1.25 },
    { key: "in", label: "دخول", w: 0.7 }, { key: "out", label: "خروج", w: 0.7 }, { key: "services", label: "خدمات", w: 1.25 },
    { key: "total", label: "إجمالي", w: 1.15 }, { key: "paid", label: "مدفوع", w: 1.5 }, { key: "nights", label: "ليالي مدفوعة", w: 0.95 },
    { key: "due", label: "متبقي", w: 1.15 }, { key: "source", label: "التسكين", w: 1.2 },
  ];
  const rows = [];
  const dueAll = {};
  let occupied = 0, arrivals = 0, departures = 0;
  (rooms || []).forEach((r) => {
    const list = bookingsForDay(bookings, r.number, date);
    if (!list.length) { rows.push({ tone: "empty", cells: { room: roomText(rooms, r.number) } }); return; }
    if (list.some((b) => date < b.checkout)) occupied += 1;
    list.forEach((b) => {
      const leaving = b.checkout === date;
      if (leaving) departures += 1;
      if (b.checkin === date && !leaving) arrivals += 1;
      const nights = Math.max(1, nightsBetween(b.checkin, b.checkout));
      const online = !!b.paymentDetails?.onlinePaid;
      const pn = paidNights(b);
      const due = bookingDueLines(b);
      due.forEach((l) => sumInto(dueAll, l.currency, l.due));
      const codes = guestCodeEntries(b).map((g) => g.code);
      const other = otherTotals(b);
      rows.push({
        tone: due.length ? "due" : "ok",
        cells: {
          room: roomText(rooms, r.number),
          guest: [codes.join(" · "), b.guestName].filter(Boolean),
          price: [ltr(`${fmt(b.priceNight)} × ${nights}`), online ? "خالص (أونلاين)" : amt(b.totalRoom, b.currency)],
          in: [dayMonth(b.checkin)], out: [dayMonth(b.checkout)],
          services: servicesLines(b),
          total: [amt(bookingGrandTotal(b), b.currency), ...Object.entries(other).map(([c, v]) => amt(v, c))],
          paid: paidLines(b, paymentsIndex?.get?.(b.id)),
          nights: [`${pn.paid} من ${pn.nights}`],
          due: due.length ? due.map((l) => amt(l.due, l.currency)) : ["خالص"],
          source: [b.source || "", leaving ? (b.leftEarly ? "غادر مبكرًا" : "خروج النهارده") : b.checkin === date ? "دخول النهارده" : ""].filter(Boolean),
        },
      });
    });
  });
  return {
    id: "rooms", title: "كشف الغرف", hotelName: hotelName || "",
    head: [["اليوم", arabicWeekday(date)], ["التاريخ", ltr(date)]],
    columns, rows,
    summary: [["غرف مشغولة", `${occupied} من ${(rooms || []).length}`], ["دخول النهارده", String(arrivals)], ["خروج النهارده", String(departures)], ["إجمالي المتبقي على النزلاء", moneyText(dueAll)]],
    notes: [],
  };
}

/* سطر تحصيل: "فيزا 6,245 EGP ****1234" (السالب = رد فلوس) */
function collectionLine(r) {
  const n = Number(r.collectionAmt) || 0;
  if (n === 0) return null;
  const d = describePaymentDetails(r.collectionMethod, r.paymentDetails);
  return `${n < 0 ? "رد " : ""}${r.collectionMethod || "كاش"} ${amt(Math.abs(n), r.collectionCurrency || "EGP")}${d ? " " + isoDetails(d) : ""}`;
}
function expenseLine(r) {
  const n = Number(r.expenseAmt) || 0;
  if (n === 0) return null;
  return `${r.expenseDesc || r.expenseCategory || ""} ${amt(n, r.expenseCurrency || "EGP")}`.trim();
}
const pickMethods = (by, names) => { const out = {}; names.forEach((m) => Object.entries(by?.[m] || {}).forEach(([c, v]) => sumInto(out, c, Number(v) || 0))); return out; };

export function buildShiftSheet({ record, rooms, hotelName, staffNames }) {
  const t = computeShiftTotals(record);
  const shift = SHIFTS.find((s) => s.key === record.shiftKey);
  const numbers = [...new Set([...(rooms || []).map((r) => r.number), ...(record.rows || []).map((r) => r.room)])];
  const rows = numbers.map((n) => {
    const mine = (record.rows || []).filter((r) => r.room === n);
    const collection = mine.map(collectionLine).filter(Boolean), expenses = mine.map(expenseLine).filter(Boolean);
    const notes = mine.map((r) => r.notes).filter(Boolean);
    return { tone: collection.length || expenses.length ? "ok" : "empty", cells: { room: roomText(rooms, n), collection: [...collection, ...notes], expenses } };
  });
  const cafe = [record.cafeteria || {}, ...(record.cafeteriaRows || [])];
  const cafeCol = cafe.map((r) => { const l = collectionLine(r); return l && r.who ? `${l} (${r.who})` : l; }).filter(Boolean), cafeExp = cafe.map(expenseLine).filter(Boolean);
  if (cafeCol.length || cafeExp.length) rows.push({ tone: "section", cells: { room: ["كافيتيريا"], collection: cafeCol, expenses: cafeExp } });
  (record.hotelRows || []).forEach((r) => {
    const c = collectionLine(r), e = expenseLine(r);
    if (c || e) rows.push({ tone: "section", cells: { room: ["مصاريف الفندق"], collection: [c, r.notes].filter(Boolean), expenses: e ? [e] : [] } });
  });
  // "عملة" في الورق = الكاش اللي اتحصّل بعملة غير الجنيه
  const foreign = {};
  Object.entries(t.cashCollections || {}).forEach(([c, v]) => { if (c !== "EGP") sumInto(foreign, c, Number(v) || 0); });
  const known = new Set(["كاش", ...VISA, ...TRANSFER, ...VODAFONE]);
  const otherMethods = Object.keys(t.byMethodCurrency || {}).filter((m) => !known.has(m));
  const names = [record.staffName, ...(record.helpers || []).map((u) => staffNames?.[u] || u)].filter(Boolean).join(" + ");
  return {
    id: `shift-${record.shiftKey}`, title: `ورقة ${shift?.label || "الشيفت"}`, hotelName: hotelName || "",
    head: [["اليوم", arabicWeekday(record.date)], ["التاريخ", ltr(record.date)], ["معاد الشيفت", shift?.time || ""], ["الاسم", names], ["الحالة", record.closed ? "مقفول" : "لسه مفتوح"]],
    columns: [{ key: "room", label: "الغرفة", w: 0.9 }, { key: "collection", label: "التحصيل", w: 2.6 }, { key: "expenses", label: "المصاريف", w: 2.1 }],
    rows,
    summary: [
      ["العهدة", moneyText(record.handover)], ["إجمالي التحصيل", moneyText(t.totalCollections)], ["إجمالي المصاريف", moneyText(t.totalExpenses)], ["رصيد الخزينة", moneyText(t.closingCash)],
      ["الفيزا", moneyText(pickMethods(t.byMethodCurrency, VISA))], ["انستاباي / تحويل", moneyText(pickMethods(t.byMethodCurrency, TRANSFER))],
      ["فودافون كاش", moneyText(pickMethods(t.byMethodCurrency, VODAFONE))], ["عملة", moneyText(foreign)],
      ...otherMethods.map((m) => [m, moneyText(t.byMethodCurrency[m])]),
    ],
    notes: [record.flagged ? "⚠ فيه مشكلة تحتاج متابعة" : "", record.shiftNotes ? `ملاحظات: ${record.shiftNotes}` : ""].filter(Boolean),
  };
}

/* التقرير كله ليوم: كشف الغرف + ورقة لكل شيفت اتفتح (صباحي ← مسائي ← ليلي). الشيفت اللي لسه ماجاش مش بيطلع. */
export function buildOwnerReport({ rooms, bookings, date, records, paymentsIndex, hotelName, staffNames }) {
  const order = { morning: 0, evening: 1, night: 2 };
  const sorted = (records || []).slice().sort((a, b) => order[a.shiftKey] - order[b.shiftKey]);
  return [buildRoomsSheet({ rooms, bookings, date, paymentsIndex, hotelName }), ...sorted.map((record) => buildShiftSheet({ record, rooms, hotelName, staffNames }))];
}
