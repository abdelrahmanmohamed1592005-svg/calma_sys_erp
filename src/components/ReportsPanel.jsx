import React, { useState, useEffect, useMemo } from "react";
import { AlertTriangle, Copy, Download, Printer } from "lucide-react";
import { downloadCSV } from "./shared";
import { emptyMoney, computeShiftTotals, bookingGrandTotal, fmt, money, PAYMENT_METHODS, EXPENSE_CATEGORIES } from "../domain/money";
import { SHIFTS, OTA_SOURCES } from "../domain/constants";
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

function aggregateShifts(records) {
  const totalExpenses = emptyMoney(), totalCollections = emptyMoney(), cashCollections = emptyMoney();
  const byMethodCurrency = {}, byCategory = {};
  const flaggedShifts = [];
  records.forEach((r) => {
    const t = r.closed ? { totalExpenses: r.totalExpenses, totalCollections: r.totalCollections, cashCollections: r.cashCollections, byMethodCurrency: r.byMethodCurrency, byCategory: r.byCategory } : computeShiftTotals(r);
    ["EGP", "USD"].forEach((c) => { totalExpenses[c] += t.totalExpenses?.[c] || 0; totalCollections[c] += t.totalCollections?.[c] || 0; cashCollections[c] += t.cashCollections?.[c] || 0; });
    Object.entries(t.byMethodCurrency || {}).forEach(([m, obj]) => { byMethodCurrency[m] = byMethodCurrency[m] || emptyMoney(); ["EGP", "USD"].forEach((c) => byMethodCurrency[m][c] += obj[c] || 0); });
    Object.entries(t.byCategory || {}).forEach(([cat, obj]) => { byCategory[cat] = byCategory[cat] || emptyMoney(); ["EGP", "USD"].forEach((c) => byCategory[cat][c] += obj[c] || 0); });
    if (r.flagged) flaggedShifts.push(r);
  });
  return { totalExpenses, totalCollections, cashCollections, byMethodCurrency, byCategory, flaggedShifts, netCash: { EGP: totalCollections.EGP - totalExpenses.EGP, USD: totalCollections.USD - totalExpenses.USD } };
}

function aggregateBookings(bookings, fromDate, toDate) {
  const toDate2 = addDays(toDate, 1);
  const inRange = bookings.filter((b) => b.status !== "ملغي" && b.approvalStatus !== "pending" && b.checkin < toDate2 && b.checkout > fromDate);
  const onlineBookings = inRange.filter((b) => OTA_SOURCES.includes(b.source));
  const revenue = emptyMoney(); const extrasTotal = { laundry: 0, cafeteria: 0, tours: 0, pickup: 0, earlyCheckin: 0 };
  const bySource = {}; const byMethod = {}; const outstanding = [];
  onlineBookings.forEach((b) => {
    const gt = bookingGrandTotal(b);
    revenue[b.currency] = (revenue[b.currency] || 0) + gt;
    extrasTotal.laundry += Number(b.extras?.laundry) || 0; extrasTotal.cafeteria += Number(b.extras?.cafeteria) || 0; extrasTotal.tours += Number(b.extras?.tours) || 0; extrasTotal.pickup += Number(b.extras?.pickup) || 0;
    if (b.earlyCheckin?.applied) extrasTotal.earlyCheckin += Number(b.earlyCheckin.fee) || 0;
    bySource[b.source] = (bySource[b.source] || 0) + gt;
    byMethod[b.paymentMethod] = byMethod[b.paymentMethod] || emptyMoney(); byMethod[b.paymentMethod][b.currency] = (byMethod[b.paymentMethod][b.currency] || 0) + gt;
  });
  inRange.forEach((b) => { const gt = bookingGrandTotal(b); const due = gt - (Number(b.amountPaid) || 0); if (due > 0) outstanding.push({ ...b, due }); });
  return { count: onlineBookings.length, totalCount: inRange.length, revenue, extrasTotal, bySource, byMethod, outstanding };
}

export function ReportsPanel({ rooms, bookings, dataVersion }) {
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
  const daySpan = Math.max(1, nightsBetween(effFrom, effTo) + 1);
  const avgOccupancy = useMemo(() => {
    let sum = 0, d = effFrom, n = 0;
    while (n < daySpan) { const active = bookings.filter((b) => b.status !== "ملغي" && b.approvalStatus !== "pending" && b.checkin <= d && d < b.checkout).length; sum += active / rooms.length; d = addDays(d, 1); n++; }
    return Math.round((sum / daySpan) * 100);
  }, [bookings, effFrom, daySpan, rooms.length]);

  function buildSummaryText() {
    let txt = `تقرير فندق Calma\n${rangeMode === "day" ? `${arabicWeekday(date)} ${arabicDateLong(date)}` : `من ${fromDate} إلى ${toDate}`}\n\n`;
    if (rangeMode === "day") { SHIFTS.forEach((s) => { const r = dayRecords[s.key]; if (!r) { txt += `${s.label}: لا يوجد سجل\n`; return; } const t = r.closed ? r : computeShiftTotals(r); txt += `${s.label} (${r.staffName}) — ${r.closed ? "مقفول" : "مفتوح"}\nتحصيل: ${money(t.totalCollections, "EGP")}ج + ${money(t.totalCollections, "USD")}$ | مصاريف: ${money(t.totalExpenses, "EGP")}ج + ${money(t.totalExpenses, "USD")}$ | رصيد الخزينة: ${money(t.closingCash, "EGP")}ج + ${money(t.closingCash, "USD")}$\n`; if (r.flagged) txt += `تنبيه متابعة: ${r.shiftNotes || "—"}\n`; txt += `\n`; }); }
    txt += `إجمالي التحصيل: ${money(agg.totalCollections, "EGP")}ج + ${money(agg.totalCollections, "USD")}$\nإجمالي المصاريف: ${money(agg.totalExpenses, "EGP")}ج + ${money(agg.totalExpenses, "USD")}$\nصافي النقدية: ${money(agg.netCash, "EGP")}ج + ${money(agg.netCash, "USD")}$\nإيراد الحجوزات الأونلاين: ${money(bAgg.revenue, "EGP")}ج + ${money(bAgg.revenue, "USD")}$\nنسبة الإشغال: ${avgOccupancy}%`;
    return txt;
  }
  async function copySummary() { const t = buildSummaryText(); setCopyText(t); try { await navigator.clipboard.writeText(t); } catch (e) {} }
  function exportCSV() {
    const headers = ["الشيفت/اليوم", "الموظف", "الحالة", "تحصيل EGP", "تحصيل USD", "مصاريف EGP", "مصاريف USD", "رصيد EGP", "رصيد USD"];
    const rows = records.map((r) => { const t = r.closed ? r : computeShiftTotals(r); return [`${r.date} - ${SHIFTS.find((s) => s.key === r.shiftKey)?.label}`, r.staffName, r.closed ? "مقفول" : "مفتوح", t.totalCollections.EGP, t.totalCollections.USD, t.totalExpenses.EGP, t.totalExpenses.USD, t.closingCash.EGP, t.closingCash.USD]; });
    downloadCSV(`report-${effFrom}-to-${effTo}.csv`, headers, rows);
  }

  return (
    <div style={{ padding: 14 }}>
      <div className="cx-no-print" style={{ display: "flex", gap: 8, alignItems: "flex-end", marginBottom: 14, flexWrap: "wrap" }}>
        <button className={"cx-btn " + (rangeMode === "day" ? "cx-btn-gold" : "cx-btn-outline")} onClick={() => setRangeMode("day")}>يوم واحد</button>
        <button className={"cx-btn " + (rangeMode === "range" ? "cx-btn-gold" : "cx-btn-outline")} onClick={() => setRangeMode("range")}>فترة (أسبوعي/شهري)</button>
        {rangeMode === "day" ? (
          <div><label style={{ fontSize: 11, color: "var(--muted)", display: "block" }}>التاريخ</label><input className="cx-input" type="date" style={{ width: 170 }} value={date} onChange={(e) => setDate(e.target.value)} /></div>
        ) : (<>
          <div><label style={{ fontSize: 11, color: "var(--muted)", display: "block" }}>من</label><input className="cx-input" type="date" style={{ width: 160 }} value={fromDate} onChange={(e) => setFromDate(e.target.value)} /></div>
          <div><label style={{ fontSize: 11, color: "var(--muted)", display: "block" }}>إلى</label><input className="cx-input" type="date" style={{ width: 160 }} value={toDate} onChange={(e) => setToDate(e.target.value)} /></div>
        </>)}
        <button className="cx-btn cx-btn-outline" onClick={exportCSV}><Download size={13} /> تصدير CSV</button>
        <button className="cx-btn cx-btn-outline" onClick={() => window.print()}><Printer size={13} /> طباعة</button>
      </div>

      {loading ? <div style={{ padding: "3rem 1rem", textAlign: "center", color: "var(--muted)" }}>جارِ التحميل...</div> : (
        <>
          {rangeMode === "day" && (
            <div style={{ overflowX: "auto", marginBottom: 14 }}>
              <table className="cx-table" style={{ fontSize: 12, minWidth: 700 }}>
                <thead><tr><th className="cx-th">الشيفت</th><th className="cx-th">الموظف</th><th className="cx-th">الحالة</th><th className="cx-th">تحصيل EGP</th><th className="cx-th">تحصيل USD</th><th className="cx-th">مصاريف EGP</th><th className="cx-th">مصاريف USD</th><th className="cx-th">رصيد EGP</th><th className="cx-th">رصيد USD</th><th className="cx-th">متابعة</th></tr></thead>
                <tbody>
                  {SHIFTS.map((s) => { const r = dayRecords[s.key]; if (!r) return (<tr key={s.key}><td>{s.label}</td><td colSpan={9} style={{ color: "var(--muted)" }}>لا يوجد سجل</td></tr>); const t = r.closed ? r : computeShiftTotals(r);
                    return (<tr key={s.key}><td>{s.label}</td><td>{r.staffName}</td><td>{r.closed ? "مقفول" : "مفتوح"}</td><td>{money(t.totalCollections, "EGP")}</td><td>{money(t.totalCollections, "USD")}</td><td>{money(t.totalExpenses, "EGP")}</td><td>{money(t.totalExpenses, "USD")}</td><td style={{ fontWeight: 700 }}>{money(t.closingCash, "EGP")}</td><td style={{ fontWeight: 700 }}>{money(t.closingCash, "USD")}</td><td>{r.flagged ? <AlertTriangle size={14} color="#A8503B" /> : "—"}</td></tr>);
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 10, marginBottom: 14 }}>
            <div className="cx-card" style={{ padding: 10 }}><div style={{ fontSize: 11, color: "var(--muted)" }}>إجمالي التحصيل</div><div style={{ fontWeight: 800, fontSize: 16 }}>{money(agg.totalCollections, "EGP")} ج</div><div style={{ fontWeight: 800, fontSize: 16 }}>{money(agg.totalCollections, "USD")} $</div></div>
            <div className="cx-card" style={{ padding: 10 }}><div style={{ fontSize: 11, color: "var(--muted)" }}>إجمالي المصاريف</div><div style={{ fontWeight: 800, fontSize: 16 }}>{money(agg.totalExpenses, "EGP")} ج</div><div style={{ fontWeight: 800, fontSize: 16 }}>{money(agg.totalExpenses, "USD")} $</div></div>
            <div className="cx-card" style={{ padding: 10 }}><div style={{ fontSize: 11, color: "var(--muted)" }}>صافي النقدية</div><div style={{ fontWeight: 800, fontSize: 16, color: "var(--teal)" }}>{money(agg.netCash, "EGP")} ج</div><div style={{ fontWeight: 800, fontSize: 16, color: "var(--teal)" }}>{money(agg.netCash, "USD")} $</div></div>
            <div className="cx-card" style={{ padding: 10 }}><div style={{ fontSize: 11, color: "var(--muted)" }}>متوسط نسبة الإشغال</div><div style={{ fontWeight: 800, fontSize: 20 }}>{avgOccupancy}%</div></div>
          </div>

          <div className="cx-card" style={{ padding: 12, marginBottom: 14 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 6 }}>التحصيل النقدي حسب طريقة الدفع والعملة</div>
            <div style={{ overflowX: "auto" }}><table className="cx-table" style={{ fontSize: 12 }}><thead><tr><th className="cx-th">طريقة الدفع</th><th className="cx-th">جنيه EGP</th><th className="cx-th">دولار USD</th></tr></thead><tbody>{PAYMENT_METHODS.map((m) => <tr key={m}><td>{m}</td><td>{money(agg.byMethodCurrency[m], "EGP")}</td><td>{money(agg.byMethodCurrency[m], "USD")}</td></tr>)}</tbody></table></div>
          </div>

          <div className="cx-card" style={{ padding: 12, marginBottom: 14 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 6 }}>المصاريف حسب البند</div>
            <div style={{ overflowX: "auto" }}><table className="cx-table" style={{ fontSize: 12 }}><thead><tr><th className="cx-th">البند</th><th className="cx-th">جنيه EGP</th><th className="cx-th">دولار USD</th></tr></thead><tbody>{EXPENSE_CATEGORIES.map((c) => <tr key={c}><td>{c}</td><td>{money(agg.byCategory[c], "EGP")}</td><td>{money(agg.byCategory[c], "USD")}</td></tr>)}</tbody></table></div>
          </div>

          <div className="cx-card" style={{ padding: 12, marginBottom: 14 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 2 }}>إيراد الحجوزات الأونلاين ({bAgg.count} حجز مدفوع أونلاين من إجمالي {bAgg.totalCount} حجز في الفترة)</div>
            <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 8 }}>القسم ده بيشمل بس الحجوزات الجايه من منصات الأونلاين (Booking.com / Trip.com). أي حجز تاني بيتحسب في اليومية عادي عشان ما يتحسبش مرتين.</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 10, marginBottom: 10 }}>
              <div><div style={{ fontSize: 11, color: "var(--muted)" }}>الإيراد بالدولار</div><div style={{ fontWeight: 800 }}>{money(bAgg.revenue, "USD")} $</div></div>
              <div><div style={{ fontSize: 11, color: "var(--muted)" }}>الإيراد بالجنيه</div><div style={{ fontWeight: 800 }}>{money(bAgg.revenue, "EGP")} ج</div></div>
              <div><div style={{ fontSize: 11, color: "var(--muted)" }}>غسيل</div><div style={{ fontWeight: 800 }}>{fmt(bAgg.extrasTotal.laundry)}</div></div>
              <div><div style={{ fontSize: 11, color: "var(--muted)" }}>كافيتيريا</div><div style={{ fontWeight: 800 }}>{fmt(bAgg.extrasTotal.cafeteria)}</div></div>
              <div><div style={{ fontSize: 11, color: "var(--muted)" }}>جولات</div><div style={{ fontWeight: 800 }}>{fmt(bAgg.extrasTotal.tours)}</div></div>
              <div><div style={{ fontSize: 11, color: "var(--muted)" }}>بيك أب</div><div style={{ fontWeight: 800 }}>{fmt(bAgg.extrasTotal.pickup)}</div></div>
              <div><div style={{ fontSize: 11, color: "var(--muted)" }}>دخول مبكر</div><div style={{ fontWeight: 800 }}>{fmt(bAgg.extrasTotal.earlyCheckin)}</div></div>
            </div>
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>حسب جهة الحجز</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>{Object.entries(bAgg.bySource).map(([s, v]) => <span key={s} className="cx-pill" style={{ background: "var(--paper2)" }}>{s}: {fmt(v)}</span>)}</div>
            {bAgg.outstanding.length > 0 && (<>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6, color: "var(--rust)" }}>مبالغ متبقية على نزلاء - كل الحجوزات ({bAgg.outstanding.length})</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>{bAgg.outstanding.map((b) => <div key={b.id} style={{ fontSize: 12, display: "flex", justifyContent: "space-between", borderBottom: "1px solid var(--hair)", padding: "4px 0" }}><span>غرفة {b.room} · {b.guestName}</span><span style={{ color: "var(--rust)", fontWeight: 700 }}>{fmt(b.due)} {b.currency}</span></div>)}</div>
            </>)}
          </div>

          {agg.flaggedShifts.length > 0 && (
            <div className="cx-card" style={{ padding: 12, marginBottom: 14, borderColor: "var(--rust)" }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 6, color: "var(--rust)" }}>شيفتات فيها ملاحظات متابعة</div>
              {agg.flaggedShifts.map((r) => <div key={r.date + r.shiftKey} style={{ fontSize: 12, padding: "4px 0", borderBottom: "1px solid var(--hair)" }}>{r.date} — {SHIFTS.find((s) => s.key === r.shiftKey)?.label} ({r.staffName}): {r.shiftNotes || "بدون تفاصيل"}</div>)}
            </div>
          )}

          <button className="cx-btn cx-btn-outline cx-no-print" onClick={copySummary}><Copy size={14} /> نسخ الملخص</button>
          {copyText && <textarea className="cx-textarea" readOnly value={copyText} rows={8} style={{ marginTop: 10 }} onFocus={(e) => e.target.select()} />}
        </>
      )}
    </div>
  );
}
