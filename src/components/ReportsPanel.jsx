import React, { useState, useEffect, useMemo } from "react";
import { AlertTriangle, Copy, Download, Printer } from "lucide-react";
import { downloadCSV } from "./shared";
import { emptyMoney, computeShiftTotals, bookingGrandTotal, onlineNetAmount, fmt, money, currencyKeysOf, PAYMENT_METHODS, EXPENSE_CATEGORIES } from "../domain/money";
import { SHIFTS } from "../domain/constants";
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
  return { totalExpenses, totalCollections, cashCollections, byMethodCurrency, byCategory, flaggedShifts, netCash };
}

function aggregateBookings(bookings, fromDate, toDate) {
  const toDate2 = addDays(toDate, 1);
  const inRange = bookings.filter((b) => b.status !== "ملغي" && b.checkin < toDate2 && b.checkout > fromDate);
  const onlineBookings = inRange.filter((b) => b.paymentDetails?.onlinePaid);
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
  const outstanding = [];
  inRange.forEach((b) => { const gt = bookingGrandTotal(b); const due = gt - (Number(b.amountPaid) || 0); if (due > 0) outstanding.push({ ...b, due }); });
  return { count: onlineBookings.length, totalCount: inRange.length, grossRevenue, netRevenue, items, outstanding };
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
  const reportCurrencies = useMemo(() => currencyKeysOf(agg.totalCollections, agg.totalExpenses, agg.netCash), [agg]);
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
    txt += `إجمالي التحصيل: ${moneyLine(agg.totalCollections)}\nإجمالي المصاريف: ${moneyLine(agg.totalExpenses)}\nصافي النقدية: ${moneyLine(agg.netCash)}\nإيراد الحجوزات الأونلاين (بالعمولة): ${moneyLine(bAgg.netRevenue)}\nنسبة الإشغال: ${avgOccupancy}%`;
    return txt;
  }
  async function copySummary() { const t = buildSummaryText(); setCopyText(t); try { await navigator.clipboard.writeText(t); } catch (e) {} }

  function exportCSV() {
    const headers = ["التاريخ", "الشيفت", "الموظف", "الحالة", ...reportCurrencies.flatMap((c) => [`تحصيل ${c}`, `مصاريف ${c}`, `رصيد ${c}`])];
    const rows = records.map((r) => { const t = r.closed ? r : computeShiftTotals(r); return [r.date, SHIFTS.find((s) => s.key === r.shiftKey)?.label, r.staffName, r.closed ? "مقفول" : "مفتوح", ...reportCurrencies.flatMap((c) => [t.totalCollections?.[c] || 0, t.totalExpenses?.[c] || 0, t.closingCash?.[c] || 0])]; });
    downloadCSV(`تقرير-${effFrom}-الى-${effTo}.csv`, headers, rows);
  }

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
        <button className="cx-btn cx-btn-outline" onClick={exportCSV}><Download size={13} /> تصدير CSV</button>
        <button className="cx-btn cx-btn-outline" onClick={() => window.print()}><Printer size={13} /> طباعة</button>
      </div>

      {loading ? <div style={{ padding: "3rem 1rem", textAlign: "center", color: "var(--muted)" }}>جارِ التحميل...</div> : (
        <>
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

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 10, marginBottom: 14 }}>
            <div className="cx-card" style={{ padding: 10 }}><div style={{ fontSize: 11, color: "var(--muted)" }}>إجمالي التحصيل</div><div style={{ fontWeight: 800, fontSize: 16 }}>{moneyLine(agg.totalCollections)}</div></div>
            <div className="cx-card" style={{ padding: 10 }}><div style={{ fontSize: 11, color: "var(--muted)" }}>إجمالي المصاريف</div><div style={{ fontWeight: 800, fontSize: 16 }}>{moneyLine(agg.totalExpenses)}</div></div>
            <div className="cx-card" style={{ padding: 10 }}><div style={{ fontSize: 11, color: "var(--muted)" }}>صافي النقدية</div><div style={{ fontWeight: 800, fontSize: 16, color: "var(--teal)" }}>{moneyLine(agg.netCash)}</div></div>
            <div className="cx-card" style={{ padding: 10 }}><div style={{ fontSize: 11, color: "var(--muted)" }}>متوسط نسبة الإشغال</div><div style={{ fontWeight: 800, fontSize: 20 }}>{avgOccupancy}%</div></div>
          </div>

          <div className="cx-card" style={{ padding: 12, marginBottom: 14 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 6 }}>التحصيل حسب طريقة الدفع والعملة</div>
            <div style={{ overflowX: "auto" }}><table className="cx-table" style={{ fontSize: 12 }}><thead><tr><th className="cx-th">طريقة الدفع</th>{reportCurrencies.map((c) => <th className="cx-th" key={c}>{c}</th>)}</tr></thead><tbody>{PAYMENT_METHODS.map((m) => <tr key={m}><td>{m}</td>{reportCurrencies.map((c) => <td key={c}>{money(agg.byMethodCurrency[m], c)}</td>)}</tr>)}</tbody></table></div>
          </div>

          <div className="cx-card" style={{ padding: 12, marginBottom: 14 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 6 }}>المصاريف حسب البند</div>
            <div style={{ overflowX: "auto" }}><table className="cx-table" style={{ fontSize: 12 }}><thead><tr><th className="cx-th">البند</th>{reportCurrencies.map((c) => <th className="cx-th" key={c}>{c}</th>)}</tr></thead><tbody>{EXPENSE_CATEGORIES.map((c) => <tr key={c}><td>{c}</td>{reportCurrencies.map((cur) => <td key={cur}>{money(agg.byCategory[c], cur)}</td>)}</tr>)}</tbody></table></div>
          </div>

          <div className="cx-card" style={{ padding: 12, marginBottom: 14 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 2 }}>الحجوزات الأونلاين ({bAgg.count} حجز مدفوع أونلاين من إجمالي {bAgg.totalCount} حجز في الفترة)</div>
            <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 8 }}>القسم ده بيشمل بس الحجوزات اللي اتحددت يدويًا كـ"مدفوعة أونلاين" وقت إنشاء أو تعديل الحجز.</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 10, marginBottom: 12 }}>
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
            {bAgg.outstanding.length > 0 && (<>
              <div style={{ fontSize: 12, fontWeight: 700, marginTop: 12, marginBottom: 6, color: "var(--rust)" }}>مبالغ متبقية على نزلاء - كل الحجوزات ({bAgg.outstanding.length})</div>
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
