import React, { useState, useEffect, useMemo } from "react";
import { AlertTriangle, Copy, Printer } from "lucide-react";
import { Logo } from "./shared";
import { emptyMoney, computeShiftTotals, bookingGrandTotal, onlineNetAmount, directBookingPaymentsByMethod, fmt, money, currencyKeysOf, PAYMENT_METHODS, EXPENSE_CATEGORIES } from "../domain/money";
import { SHIFTS, HOTEL_NAME } from "../domain/constants";
import { todayStr, addDays, arabicWeekday, arabicDateLong, nightsBetween } from "../domain/dates";
import { getShiftRecord } from "../data/shifts";

async function loadShiftsInRange(fromDate, toDate) {
  const out = [];
  let d = fromDate, guard = 0;
  while (d <= toDate && guard < 370) {
    for (const s of SHIFTS) { const r = await getShiftRecord(d, s.key); if (r) out.push(r); }
    d = addDays(d, 1); guard++;
  }
  return out;
}

function addMoneyInto(target, source) {
  currencyKeysOf(source).forEach((c) => { target[c] = (target[c] || 0) + (source[c] || 0); });
}

// أول عهدة متسجلة لوسيلة دفع (غير الكاش) في أول شيفت ليه قراءة مسجّلة ضمن
// الفترة المختارة - دي "كانت قبل كام" بالنسبة لتقرير المتابعة (مثلاً عهدة
// جهاز الفيزا في بداية الفترة).
function firstMethodHandover(records) {
  for (const r of records) {
    if (r.methodHandover && Object.keys(r.methodHandover).length > 0) return r.methodHandover;
  }
  return {};
}

// نفس المنطق بالظبط بس لعهدة الكاش (الدرج) - عهدة أول شيفت في الفترة بكل
// عملاتها، عشان جدول متابعة العملات في التقرير يبقى شامل الكاش كمان مش بس
// وسائل الدفع الأخرى.
function firstCashHandover(records) {
  for (const r of records) {
    if (r.handover && Object.keys(r.handover).length > 0) return r.handover;
  }
  return {};
}

function aggregateShifts(records) {
  const totalExpenses = emptyMoney(), totalCollections = emptyMoney(), cashCollections = emptyMoney();
  const byMethodCurrency = {}, byCategory = {};
  const flaggedShifts = [];
  records.forEach((r) => {
    const t = r.closed ? { totalExpenses: r.totalExpenses, totalCollections: r.totalCollections, cashCollections: r.cashCollections, byMethodCurrency: r.byMethodCurrency, byCategory: r.byCategory } : computeShiftTotals(r);
    addMoneyInto(totalExpenses, t.totalExpenses || {});
    addMoneyInto(totalCollections, t.totalCollections || {});
    addMoneyInto(cashCollections, t.cashCollections || {});
    Object.entries(t.byMethodCurrency || {}).forEach(([m, obj]) => { byMethodCurrency[m] = byMethodCurrency[m] || emptyMoney(); addMoneyInto(byMethodCurrency[m], obj); });
    Object.entries(t.byCategory || {}).forEach(([cat, obj]) => { byCategory[cat] = byCategory[cat] || emptyMoney(); addMoneyInto(byCategory[cat], obj); });
    if (r.flagged) flaggedShifts.push(r);
  });
  const netCash = emptyMoney();
  currencyKeysOf(totalCollections, totalExpenses).forEach((c) => { netCash[c] = (totalCollections[c] || 0) - (totalExpenses[c] || 0); });
  // متابعة عهدة وسائل الدفع الأخرى (فيزا، إلخ) عبر الفترة: كانت قبل + حصلت
  // في الفترة = الإجمالي دلوقتي. مبني على عهدة اليومية وتحصيلها فقط (مش
  // متضمن تحصيل الحجوزات المباشر) عشان الحساب يفضل متطابق مع قراءة الجهاز
  // الفعلية خطوة بخطوة شيفت بشيفت.
  const methodOpening = firstMethodHandover(records);
  const methodClosingNow = {};
  new Set([...Object.keys(methodOpening), ...Object.keys(byMethodCurrency)]).forEach((m) => {
    if (m === "كاش") return;
    methodClosingNow[m] = emptyMoney();
    currencyKeysOf(methodOpening[m], byMethodCurrency[m]).forEach((cur) => {
      methodClosingNow[m][cur] = (methodOpening[m]?.[cur] || 0) + (byMethodCurrency[m]?.[cur] || 0);
    });
  });
  // نفس فكرة "متابعة العهدة" بس للكاش نفسه: عهدة أول شيفت في الفترة + كل
  // التحصيل النقدي - كل المصاريف (المصاريف دايمًا بتُدفع من الكاش) = رصيد
  // الدرج دلوقتي بكل عملة. ده غير netCash اللي فوق (تحصيل كل الوسائل مجمّعة
  // ناقص المصاريف) - cashClosingNow هنا مطابق لرصيد الدرج الفعلي.
  const cashOpening = firstCashHandover(records);
  const cashClosingNow = emptyMoney();
  currencyKeysOf(cashOpening, cashCollections, totalExpenses).forEach((cur) => {
    cashClosingNow[cur] = (cashOpening[cur] || 0) + (cashCollections[cur] || 0) - (totalExpenses[cur] || 0);
  });
  return { totalExpenses, totalCollections, cashCollections, byMethodCurrency, byCategory, flaggedShifts, netCash, methodOpening, methodClosingNow, cashOpening, cashClosingNow };
}

function aggregateBookings(bookings, fromDate, toDate) {
  const toDate2 = addDays(toDate, 1);
  const inRange = bookings.filter((b) => b.status !== "ملغي" && b.checkin < toDate2 && b.checkout > fromDate);
  const onlineBookings = inRange.filter((b) => b.paymentDetails?.onlinePaid);
  const directBookings = inRange.filter((b) => !b.paymentDetails?.onlinePaid);
  const grossRevenue = emptyMoney(); const netRevenue = emptyMoney();
  const items = [];
  onlineBookings.forEach((b) => {
    const gross = bookingGrandTotal(b);
    const commissionPct = Number(b.paymentDetails?.commissionPct) || 0;
    const net = onlineNetAmount(gross, commissionPct);
    grossRevenue[b.currency] = (grossRevenue[b.currency] || 0) + gross;
    netRevenue[b.currency] = (netRevenue[b.currency] || 0) + net;
    items.push({ id: b.id, room: b.room, guestName: b.guestName, checkin: b.checkin, checkout: b.checkout, currency: b.currency, gross, net, commissionPct, paymentDetails: b.paymentDetails });
  });
  // تحصيل الحجوزات اللي اتدفعت مباشر (مش أونلاين) حسب طريقة الدفع - دي
  // المبالغ اللي بتتسجل وقت "تسجيل تحصيل" على الحجز نفسه (فيزا/انستاباي/
  // فودافون كاش/تحويل بنكي...) ومش بتمر على يومية الشيفت، فلازم تتجمع هنا
  // عشان تظهر في التقرير.
  const byMethodCurrency = directBookingPaymentsByMethod(directBookings);
  // المبالغ المتبقية على النزلاء: للحجز المدفوع أونلاين، سعر الغرفة نفسه
  // متسوّى بالفعل عن طريق منصة الحجز (ده اللي قسم "الحجوزات الأونلاين" فوق
  // بيتابعه بالعمولة) - فمينفعش يفضل ظاهر كـ"متبقي" تاني هنا. اللي ممكن
  // يفضل متبقي بس هو أي خدمة إضافية (غسيل/كافيتيريا/جولات/بيك أب/دخول مبكر)
  // اتاخدت في الفندق ومتحصّلتش لسه - دي لوحدها المحسوبة هنا للحجز الأونلاين.
  const outstanding = [];
  inRange.forEach((b) => {
    const gt = bookingGrandTotal(b);
    if (b.paymentDetails?.onlinePaid) {
      const extrasTotal = gt - (Number(b.totalRoom) || 0);
      const due = extrasTotal - (Number(b.amountPaid) || 0);
      if (due > 0) outstanding.push({ ...b, due, onlineExtrasOnly: true });
    } else {
      const due = gt - (Number(b.amountPaid) || 0);
      if (due > 0) outstanding.push({ ...b, due, onlineExtrasOnly: false });
    }
  });
  return { count: onlineBookings.length, totalCount: inRange.length, grossRevenue, netRevenue, items, outstanding, byMethodCurrency };
}

export function ReportsPanel({ rooms, bookings, dataVersion, profile }) {
  const [rangeMode, setRangeMode] = useState("day");
  const [date, setDate] = useState(todayStr());
  const [fromDate, setFromDate] = useState(addDays(todayStr(), -6));
  const [toDate, setToDate] = useState(todayStr());
  const [records, setRecords] = useState([]);
  const [dayRecords, setDayRecords] = useState({});
  const [loading, setLoading] = useState(true);
  const [copyText, setCopyText] = useState("");

  const effFrom = rangeMode === "day" ? date : fromDate;
  const effTo = rangeMode === "day" ? date : toDate;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      if (rangeMode === "day") { const out = {}; for (const s of SHIFTS) out[s.key] = await getShiftRecord(date, s.key); if (!cancelled) setDayRecords(out); }
      const recs = await loadShiftsInRange(effFrom, effTo);
      if (!cancelled) { setRecords(recs); setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [rangeMode, date, fromDate, toDate, dataVersion]);

  const agg = useMemo(() => aggregateShifts(records), [records]);
  const bAgg = useMemo(() => aggregateBookings(bookings, effFrom, effTo), [bookings, effFrom, effTo]);
  // دمج تحصيل اليومية (كاش غالبًا) مع تحصيل الحجوزات المباشر بطرق الدفع
  // التانية (فيزا/انستاباي/فودافون كاش/تحويل بنكي...) عشان "التحصيل حسب
  // طريقة الدفع" و"إجمالي التحصيل" يعكسوا الصورة الحقيقية كاملة.
  const combinedByMethodCurrency = useMemo(() => {
    const out = {};
    Object.entries(agg.byMethodCurrency).forEach(([m, obj]) => { out[m] = { ...obj }; });
    Object.entries(bAgg.byMethodCurrency).forEach(([m, obj]) => {
      out[m] = out[m] || {};
      Object.entries(obj).forEach(([c, v]) => { out[m][c] = (out[m][c] || 0) + v; });
    });
    return out;
  }, [agg, bAgg]);
  const combinedTotalCollections = useMemo(() => {
    const out = { ...agg.totalCollections };
    Object.values(bAgg.byMethodCurrency).forEach((obj) => {
      currencyKeysOf(obj).forEach((c) => { out[c] = (out[c] || 0) + (obj[c] || 0); });
    });
    return out;
  }, [agg, bAgg]);
  const reportCurrencies = useMemo(() => currencyKeysOf(agg.totalCollections, agg.totalExpenses, agg.netCash, combinedTotalCollections), [agg, combinedTotalCollections]);
  const daySpan = Math.max(1, nightsBetween(effFrom, effTo) + 1);
  const avgOccupancy = useMemo(() => {
    let sum = 0, d = effFrom, n = 0;
    while (n < daySpan) { const active = bookings.filter((b) => b.status !== "ملغي" && b.checkin <= d && d < b.checkout).length; sum += active / rooms.length; d = addDays(d, 1); n++; }
    return Math.round((sum / daySpan) * 100);
  }, [bookings, effFrom, daySpan, rooms.length]);

  function moneyLine(obj, currencies) { const cs = currencies || currencyKeysOf(obj); return cs.length ? cs.map((c) => `${money(obj, c)}${c === "EGP" ? "ج" : c === "USD" ? "$" : " " + c}`).join(" + ") : "0"; }

  function buildSummaryText() {
    let txt = `تقرير فندق Calma\n${rangeMode === "day" ? `${arabicWeekday(date)} ${arabicDateLong(date)}` : `من ${fromDate} إلى ${toDate}`}\n\n`;
    if (rangeMode === "day") { SHIFTS.forEach((s) => { const r = dayRecords[s.key]; if (!r) { txt += `${s.label}: لا يوجد سجل\n`; return; } const t = r.closed ? r : computeShiftTotals(r); txt += `${s.label} (${r.staffName}) — ${r.closed ? "مقفول" : "مفتوح"}\nتحصيل: ${moneyLine(t.totalCollections)} | مصاريف: ${moneyLine(t.totalExpenses)} | رصيد الخزينة: ${moneyLine(t.closingCash)}\n`; if (r.flagged) txt += `تنبيه متابعة: ${r.shiftNotes || "—"}\n`; txt += `\n`; }); }
    txt += `إجمالي التحصيل: ${moneyLine(combinedTotalCollections)}\nإجمالي المصاريف: ${moneyLine(agg.totalExpenses)}\nصافي النقدية (الدرج): ${moneyLine(agg.netCash)}\n`;
    PAYMENT_METHODS.forEach((m) => { const obj = combinedByMethodCurrency[m]; if (obj && currencyKeysOf(obj).length) txt += `  - ${m}: ${moneyLine(obj)}\n`; });
    txt += `إيراد الحجوزات الأونلاين (بالعمولة): ${moneyLine(bAgg.netRevenue)}\nنسبة الإشغال: ${avgOccupancy}%`;
    return txt;
  }
  async function copySummary() { const t = buildSummaryText(); setCopyText(t); try { await navigator.clipboard.writeText(t); } catch (e) {} }

  return (
    <div style={{ padding: 14 }}>
      <div className="cx-no-print" style={{ marginBottom: 14, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div style={{ display: "flex", gap: 6 }}>
          <button className={"cx-btn " + (rangeMode === "day" ? "cx-btn-gold" : "cx-btn-outline")} onClick={() => setRangeMode("day")}>يوم واحد</button>
          <button className={"cx-btn " + (rangeMode === "range" ? "cx-btn-gold" : "cx-btn-outline")} onClick={() => setRangeMode("range")}>فترة</button>
        </div>
        {rangeMode === "day" ? (
          <div><label style={{ fontSize: 11, color: "var(--muted)", display: "block" }}>التاريخ</label><input className="cx-input" type="date" style={{ width: 170 }} value={date} onChange={(e) => setDate(e.target.value)} /></div>
        ) : (<>
          <div><label style={{ fontSize: 11, color: "var(--muted)", display: "block" }}>من</label><input className="cx-input" type="date" style={{ width: 160 }} value={fromDate} onChange={(e) => setFromDate(e.target.value)} /></div>
          <div><label style={{ fontSize: 11, color: "var(--muted)", display: "block" }}>إلى</label><input className="cx-input" type="date" style={{ width: 160 }} value={toDate} onChange={(e) => setToDate(e.target.value)} /></div>
        </>)}
        <button className="cx-btn cx-btn-gold" onClick={() => window.print()}><Printer size={13} /> طباعة التقرير</button>
      </div>

      {loading ? <div style={{ padding: "3rem 1rem", textAlign: "center", color: "var(--muted)" }}>جارِ التحميل...</div> : (
        <>
          {/* ترويسة التقرير المطبوع - بتظهر بس وقت الطباعة/التصدير كـ PDF،
              مش في الشاشة، عشان الورقة تطلع شكل رسمي باسم الفندق والفترة
              وتاريخ الإصدار ومين أصدره. */}
          <div className="cx-print-only cx-print-header">
            <div className="cx-print-head-row">
              <div className="cx-print-brand">
                <Logo size={30} />
                {HOTEL_NAME && <div className="cx-print-hotel-name">{HOTEL_NAME}</div>}
              </div>
              <div className="cx-print-meta">
                <div className="cx-print-title">تقرير مالي وتشغيلي</div>
                <div>{rangeMode === "day" ? `${arabicWeekday(date)} ${arabicDateLong(date)}` : `من ${fromDate} إلى ${toDate}`}</div>
                <div>تاريخ الإصدار: {arabicDateLong(todayStr())}{profile?.name ? ` · أُعِد بواسطة: ${profile.name}` : ""}</div>
              </div>
            </div>
            <div className="cx-print-rule" />
          </div>

          {rangeMode === "day" && (
            <div style={{ overflowX: "auto", marginBottom: 14 }}>
              <table className="cx-table" style={{ fontSize: 12, minWidth: 700 }}>
                <thead><tr><th className="cx-th">الشيفت</th><th className="cx-th">الموظف</th><th className="cx-th">الحالة</th><th className="cx-th">التحصيل</th><th className="cx-th">المصاريف</th><th className="cx-th">رصيد الخزينة</th><th className="cx-th">متابعة</th></tr></thead>
                <tbody>
                  {SHIFTS.map((s) => { const r = dayRecords[s.key]; if (!r) return (<tr key={s.key}><td>{s.label}</td><td colSpan={6} style={{ color: "var(--muted)" }}>لا يوجد سجل</td></tr>); const t = r.closed ? r : computeShiftTotals(r);
                    return (<tr key={s.key}><td>{s.label}</td><td>{r.staffName}</td><td>{r.closed ? "مقفول" : "مفتوح"}</td><td>{moneyLine(t.totalCollections)}</td><td>{moneyLine(t.totalExpenses)}</td><td style={{ fontWeight: 700 }}>{moneyLine(t.closingCash)}</td><td>{r.flagged ? <AlertTriangle size={14} color="#A8503B" /> : "—"}</td></tr>);
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="cx-report-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 10, marginBottom: 14 }}>
            <div className="cx-card" style={{ padding: 10 }}><div style={{ fontSize: 11, color: "var(--muted)" }}>إجمالي التحصيل</div><div style={{ fontWeight: 800, fontSize: 16 }}>{moneyLine(combinedTotalCollections)}</div></div>
            <div className="cx-card" style={{ padding: 10 }}><div style={{ fontSize: 11, color: "var(--muted)" }}>إجمالي المصاريف</div><div style={{ fontWeight: 800, fontSize: 16 }}>{moneyLine(agg.totalExpenses)}</div></div>
            <div className="cx-card" style={{ padding: 10 }}><div style={{ fontSize: 11, color: "var(--muted)" }}>صافي النقدية (الدرج)</div><div style={{ fontWeight: 800, fontSize: 16, color: "var(--teal)" }}>{moneyLine(agg.netCash)}</div></div>
            <div className="cx-card" style={{ padding: 10 }}><div style={{ fontSize: 11, color: "var(--muted)" }}>متوسط نسبة الإشغال</div><div style={{ fontWeight: 800, fontSize: 20 }}>{avgOccupancy}%</div></div>
          </div>

          <div className="cx-card" style={{ padding: 12, marginBottom: 14 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 2 }}>التحصيل حسب طريقة الدفع والعملة</div>
            <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>الكاش من اليومية (درج الشيفت)، وباقي الطرق (فيزا/انستاباي/فودافون كاش/تحويل بنكي...) من المبالغ المسجَّلة على الحجوزات نفسها.</div>
            <div style={{ overflowX: "auto" }}><table className="cx-table" style={{ fontSize: 12 }}><thead><tr><th className="cx-th">طريقة الدفع</th>{reportCurrencies.map((c) => <th className="cx-th" key={c}>{c}</th>)}</tr></thead><tbody>{PAYMENT_METHODS.map((m) => <tr key={m}><td>{m}</td>{reportCurrencies.map((c) => <td key={c}>{money(combinedByMethodCurrency[m], c)}</td>)}</tr>)}</tbody></table></div>
          </div>

          {PAYMENT_METHODS.some((m) => currencyKeysOf(m === "كاش" ? agg.cashOpening : agg.methodOpening?.[m], m === "كاش" ? agg.cashCollections : agg.byMethodCurrency?.[m]).length > 0) && (
            <div className="cx-card" style={{ padding: 12, marginBottom: 14 }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 2 }}>متابعة العهدة والتحصيل حسب وسيلة الدفع والعملة</div>
              <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>مبنية على العهدة المسجَّلة في أول شيفت بالفترة وتحصيل/مصاريف اليومية فقط (بكل عملة اتكتبت فيها) - مطابقة لرصيد الدرج وقراءة الجهاز خطوة بخطوة. الكاش بس عليه مصاريف لأن المصاريف بتُدفع منه.</div>
              <div style={{ overflowX: "auto" }}>
                <table className="cx-table" style={{ fontSize: 12 }}>
                  <thead><tr><th className="cx-th">الوسيلة</th><th className="cx-th">العملة</th><th className="cx-th">كانت قبل</th><th className="cx-th">حصلت في الفترة</th><th className="cx-th">مصاريف الفترة</th><th className="cx-th">الإجمالي دلوقتي</th></tr></thead>
                  <tbody>
                    {PAYMENT_METHODS.flatMap((m) => {
                      const isCash = m === "كاش";
                      const opening = isCash ? agg.cashOpening : agg.methodOpening?.[m];
                      const collected = isCash ? agg.cashCollections : agg.byMethodCurrency?.[m];
                      const closingNow = isCash ? agg.cashClosingNow : agg.methodClosingNow?.[m];
                      const curs = currencyKeysOf(opening, collected);
                      return curs.map((cur) => (
                        <tr key={m + cur}>
                          <td>{m}</td>
                          <td>{cur}</td>
                          <td>{money(opening, cur)}</td>
                          <td>{money(collected, cur)}</td>
                          <td>{isCash ? money(agg.totalExpenses, cur) : "—"}</td>
                          <td style={{ fontWeight: 800, color: "var(--teal)" }}>{money(closingNow, cur)}</td>
                        </tr>
                      ));
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="cx-card" style={{ padding: 12, marginBottom: 14 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 6 }}>المصاريف حسب البند</div>
            <div style={{ overflowX: "auto" }}><table className="cx-table" style={{ fontSize: 12 }}><thead><tr><th className="cx-th">البند</th>{reportCurrencies.map((c) => <th className="cx-th" key={c}>{c}</th>)}</tr></thead><tbody>{EXPENSE_CATEGORIES.map((c) => <tr key={c}><td>{c}</td>{reportCurrencies.map((cur) => <td key={cur}>{money(agg.byCategory[c], cur)}</td>)}</tr>)}</tbody></table></div>
          </div>

          <div className="cx-card" style={{ padding: 12, marginBottom: 14 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 2 }}>الحجوزات الأونلاين ({bAgg.count} حجز مدفوع أونلاين من إجمالي {bAgg.totalCount} حجز في الفترة)</div>
            <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 8 }}>القسم ده بيشمل بس الحجوزات اللي اتحددت يدويًا كـ"مدفوعة أونلاين" وقت إنشاء أو تعديل الحجز.</div>
            <div className="cx-report-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 10, marginBottom: 12 }}>
              <div><div style={{ fontSize: 11, color: "var(--muted)" }}>الإجمالي من غير عمولة</div><div style={{ fontWeight: 800 }}>{moneyLine(bAgg.grossRevenue)}</div></div>
              <div><div style={{ fontSize: 11, color: "var(--muted)" }}>الصافي بعد العمولة</div><div style={{ fontWeight: 800, color: "var(--teal)" }}>{moneyLine(bAgg.netRevenue)}</div></div>
            </div>
            {bAgg.items.length > 0 ? (
              <div style={{ overflowX: "auto" }}>
                <table className="cx-table" style={{ fontSize: 12, minWidth: 620 }}>
                  <thead><tr><th className="cx-th">الغرفة / النزيل</th><th className="cx-th">التواريخ</th><th className="cx-th">من غير عمولة</th><th className="cx-th">العمولة %</th><th className="cx-th">الصافي</th><th className="cx-th">تفاصيل الدفع</th></tr></thead>
                  <tbody>
                    {bAgg.items.map((it) => (
                      <tr key={it.id}>
                        <td>غرفة {it.room} · {it.guestName}</td>
                        <td style={{ whiteSpace: "nowrap" }}>{it.checkin} → {it.checkout}</td>
                        <td>{fmt(it.gross)} {it.currency}</td>
                        <td>{it.commissionPct}%</td>
                        <td style={{ fontWeight: 700, color: "var(--teal)" }}>{fmt(it.net)} {it.currency}</td>
                        <td style={{ fontSize: 11, color: "var(--muted)" }}>{it.paymentDetails?.senderName || "—"} {it.paymentDetails?.ref ? `· ${it.paymentDetails.ref}` : ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div style={{ fontSize: 12, color: "var(--muted)" }}>مفيش حجوزات متحددة كـ"مدفوعة أونلاين" في الفترة دي.</div>
            )}
          </div>

          {/* قسم مستقل تمامًا وبعيد عن الحجوزات الأونلاين - سعر الغرفة
              للحجز المدفوع أونلاين متسوّى بالفعل عن طريق المنصة فمبيظهرش هنا
              كمتبقي؛ اللي بيظهر بس هو خدمات إضافية (غسيل/كافيتيريا/جولات/
              بيك أب/دخول مبكر) متحصّلتش لسه، لأي حجز سواء أونلاين أو مباشر. */}
          {bAgg.outstanding.length > 0 && (
            <div className="cx-card" style={{ padding: 12, marginBottom: 14, borderColor: "var(--rust)" }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 2, color: "var(--rust)" }}>مبالغ متبقية على نزلاء ({bAgg.outstanding.length})</div>
              <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 8 }}>للحجوزات المدفوعة أونلاين، المتبقي هنا بس خدمات إضافية مش متحصّلة - سعر الغرفة نفسه متسوّى أونلاين ومحسوبش هنا.</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {bAgg.outstanding.map((b) => (
                  <div key={b.id} style={{ fontSize: 12, display: "flex", justifyContent: "space-between", borderBottom: "1px solid var(--hair)", padding: "4px 0" }}>
                    <span>غرفة {b.room} · {b.guestName} {b.onlineExtrasOnly && <span style={{ color: "var(--muted)", fontSize: 10.5 }}>(خدمات إضافية - الحجز مدفوع أونلاين)</span>}</span>
                    <span style={{ color: "var(--rust)", fontWeight: 700 }}>{fmt(b.due)} {b.currency}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {agg.flaggedShifts.length > 0 && (
            <div className="cx-card" style={{ padding: 12, marginBottom: 14, borderColor: "var(--rust)" }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 6, color: "var(--rust)" }}>شيفتات فيها ملاحظات متابعة</div>
              {agg.flaggedShifts.map((r) => <div key={r.date + r.shiftKey} style={{ fontSize: 12, padding: "4px 0", borderBottom: "1px solid var(--hair)" }}>{r.date} — {SHIFTS.find((s) => s.key === r.shiftKey)?.label} ({r.staffName}): {r.shiftNotes || "بدون تفاصيل"}</div>)}
            </div>
          )}

          <button className="cx-btn cx-btn-outline cx-no-print" onClick={copySummary}><Copy size={14} /> نسخ الملخص</button>
          {copyText && <textarea className="cx-textarea" readOnly value={copyText} rows={8} style={{ marginTop: 10 }} onFocus={(e) => e.target.select()} />}

          {/* تذييل الطباعة: خانة توقيع/ختم المسؤول، وسطر صغير بيوضح إن
              التقرير متولد أوتوماتيك من نظام Calma - شكل ورقة رسمية. */}
          <div className="cx-print-only cx-print-footer">
            <div className="cx-print-sign">
              <span>توقيع المسؤول: ______________________</span>
              <span>الختم:</span>
            </div>
            <div className="cx-print-generated">تم إصدار هذا التقرير أوتوماتيكيًا من نظام إدارة الفندق Calma</div>
          </div>
        </>
      )}
    </div>
  );
}
