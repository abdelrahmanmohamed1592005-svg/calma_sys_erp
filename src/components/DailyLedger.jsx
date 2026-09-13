import React, { useState, useEffect } from "react";
import { Lock, Unlock, AlertTriangle, Download, History } from "lucide-react";
import { downloadCSV } from "./shared";
import { CURRENCIES, CURRENCY_LABEL, PAYMENT_METHODS, EXPENSE_CATEGORIES, fmt, money, freshShiftRecord, computeShiftTotals } from "../domain/money";
import { SHIFTS } from "../domain/constants";
import { todayStr, arabicWeekday, defaultShiftForNow, prevShiftOf } from "../domain/dates";
import { PaymentDetailsInline } from "./shared";
import { getShiftRecord, createShiftRecord, updateShiftRecordIfUnchanged, getClaimsForDate, claimShiftRow } from "../data/shifts";

function LedgerTable({ record, locked, onUpdateRow, onUpdateCafeteria }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table className="cx-table" style={{ fontSize: 12, minWidth: 860 }}>
        <thead><tr><th className="cx-th" style={{ width: 60 }}>الغرفة</th><th className="cx-th">المصاريف</th><th className="cx-th">التحصيل</th><th className="cx-th">تفاصيل الدفع الأونلاين</th><th className="cx-th">ملاحظات</th></tr></thead>
        <tbody>
          {record.rows.map((row, idx) => (
            <tr key={row.room}>
              <td style={{ textAlign: "center", fontWeight: 700, position: "sticky", right: 0, background: "#fff" }}>{row.room}</td>
              <td>
                <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  <select className="cx-select" style={{ fontSize: 11 }} disabled={locked} value={row.expenseCategory} onChange={(e) => onUpdateRow(idx, { expenseCategory: e.target.value })}>{EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}</select>
                  <input className="cx-input" placeholder="البيان" disabled={locked} value={row.expenseDesc} onChange={(e) => onUpdateRow(idx, { expenseDesc: e.target.value })} />
                  <div style={{ display: "flex", gap: 3 }}>
                    <input className="cx-input" type="number" placeholder="المبلغ" disabled={locked} value={row.expenseAmt} onChange={(e) => onUpdateRow(idx, { expenseAmt: e.target.value })} style={{ flex: 1 }} />
                    <select className="cx-select" disabled={locked} value={row.expenseCurrency} onChange={(e) => onUpdateRow(idx, { expenseCurrency: e.target.value })} style={{ width: 62 }}>{CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}</select>
                  </div>
                </div>
              </td>
              <td>
                <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  <select className="cx-select" disabled={locked} value={row.collectionMethod} onChange={(e) => onUpdateRow(idx, { collectionMethod: e.target.value })}>{PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}</select>
                  <input className="cx-input" placeholder="بيان التحصيل" disabled={locked} value={row.collectionDesc} onChange={(e) => onUpdateRow(idx, { collectionDesc: e.target.value })} />
                  <div style={{ display: "flex", gap: 3 }}>
                    <input className="cx-input" type="number" placeholder="المبلغ" disabled={locked} value={row.collectionAmt} onChange={(e) => onUpdateRow(idx, { collectionAmt: e.target.value })} style={{ flex: 1 }} />
                    <select className="cx-select" disabled={locked} value={row.collectionCurrency} onChange={(e) => onUpdateRow(idx, { collectionCurrency: e.target.value })} style={{ width: 62 }}>{CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}</select>
                  </div>
                </div>
              </td>
              <td><PaymentDetailsInline method={row.collectionMethod} details={row.paymentDetails} disabled={locked} onChange={(d) => onUpdateRow(idx, { paymentDetails: d })} /></td>
              <td><input className="cx-input" disabled={locked} value={row.notes} onChange={(e) => onUpdateRow(idx, { notes: e.target.value })} /></td>
            </tr>
          ))}
          <tr>
            <td style={{ textAlign: "center", fontWeight: 700, position: "sticky", right: 0, background: "#fff" }}>كافيتيريا</td>
            <td>
              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                <select className="cx-select" style={{ fontSize: 11 }} disabled={locked} value={record.cafeteria.expenseCategory} onChange={(e) => onUpdateCafeteria({ expenseCategory: e.target.value })}>{EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}</select>
                <input className="cx-input" placeholder="البيان" disabled={locked} value={record.cafeteria.expenseDesc} onChange={(e) => onUpdateCafeteria({ expenseDesc: e.target.value })} />
                <div style={{ display: "flex", gap: 3 }}>
                  <input className="cx-input" type="number" placeholder="المبلغ" disabled={locked} value={record.cafeteria.expenseAmt} onChange={(e) => onUpdateCafeteria({ expenseAmt: e.target.value })} style={{ flex: 1 }} />
                  <select className="cx-select" disabled={locked} value={record.cafeteria.expenseCurrency} onChange={(e) => onUpdateCafeteria({ expenseCurrency: e.target.value })} style={{ width: 62 }}>{CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}</select>
                </div>
              </div>
            </td>
            <td>
              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                <select className="cx-select" disabled={locked} value={record.cafeteria.collectionMethod} onChange={(e) => onUpdateCafeteria({ collectionMethod: e.target.value })}>{PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}</select>
                <input className="cx-input" placeholder="بيان التحصيل" disabled={locked} value={record.cafeteria.collectionDesc} onChange={(e) => onUpdateCafeteria({ collectionDesc: e.target.value })} />
                <div style={{ display: "flex", gap: 3 }}>
                  <input className="cx-input" type="number" placeholder="المبلغ" disabled={locked} value={record.cafeteria.collectionAmt} onChange={(e) => onUpdateCafeteria({ collectionAmt: e.target.value })} style={{ flex: 1 }} />
                  <select className="cx-select" disabled={locked} value={record.cafeteria.collectionCurrency} onChange={(e) => onUpdateCafeteria({ collectionCurrency: e.target.value })} style={{ width: 62 }}>{CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}</select>
                </div>
              </div>
            </td>
            <td><PaymentDetailsInline method={record.cafeteria.collectionMethod} details={record.cafeteria.paymentDetails} disabled={locked} onChange={(d) => onUpdateCafeteria({ paymentDetails: d })} /></td>
            <td><input className="cx-input" disabled={locked} value={record.cafeteria.notes} onChange={(e) => onUpdateCafeteria({ notes: e.target.value })} /></td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function ShiftSummaryFooter({ record, totals, locked, onChangeHandover, prevClosing }) {
  return (
    <div className="cx-card" style={{ marginTop: 14, padding: 14 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        {CURRENCIES.map((cur) => (
          <div key={cur} style={{ border: "1px solid var(--hair)", borderRadius: 10, padding: 10 }}>
            <div style={{ fontWeight: 800, marginBottom: 8 }}>{CURRENCY_LABEL[cur]} ({cur})</div>
            <div style={{ marginBottom: 6 }}>
              <label style={{ fontSize: 11, color: "var(--muted)" }}>العهدة</label>
              <input className="cx-input" type="number" disabled={locked} value={record.handover?.[cur] ?? 0} onChange={(e) => onChangeHandover(cur, e.target.value)} />
              {prevClosing && <div style={{ fontSize: 10, color: "var(--muted)" }}>مقترح: {money(prevClosing, cur)}</div>}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, fontSize: 12.5 }}>
              <div><div style={{ color: "var(--muted)", fontSize: 10.5 }}>إجمالي التحصيل</div><div style={{ fontWeight: 700 }}>{money(totals.totalCollections, cur)}</div></div>
              <div><div style={{ color: "var(--muted)", fontSize: 10.5 }}>نقدًا منها</div><div style={{ fontWeight: 700 }}>{money(totals.cashCollections, cur)}</div></div>
              <div><div style={{ color: "var(--muted)", fontSize: 10.5 }}>إجمالي المصاريف</div><div style={{ fontWeight: 700 }}>{money(totals.totalExpenses, cur)}</div></div>
              <div><div style={{ color: "var(--muted)", fontSize: 10.5 }}>رصيد الخزينة</div><div style={{ fontWeight: 800, color: "var(--teal)" }}>{money(totals.closingCash, cur)}</div></div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ShiftClaimPicker({ date, claims, onClaim }) {
  const nowShift = defaultShiftForNow();
  return (
    <div className="cx-card" style={{ padding: 16 }}>
      <div style={{ fontWeight: 800, marginBottom: 4 }}>اختار شيفتك النهارده ({arabicWeekday(date)} · {date})</div>
      <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 12 }}>الاختيار ده بيتحدد مرة واحدة بس ومينفعش تغيّره بعد كده، وهتقدر تعدل بس على الشيفت ده لحد ما يخلص اليوم. كل شيفت مينفتحش غير في معاده الفعلي.</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {SHIFTS.map((s) => {
          const taken = claims[s.key];
          const notYourTime = s.key !== nowShift;
          const disabled = !!taken || notYourTime;
          return (
            <button key={s.key} disabled={disabled} onClick={() => onClaim(s.key)}
              className="cx-btn cx-btn-outline" style={{ justifyContent: "space-between", padding: "12px 14px", fontSize: 13.5, opacity: disabled ? 0.5 : 1 }}>
              <span>{s.label} <span style={{ fontWeight: 400, color: "var(--muted)" }}>({s.time})</span></span>
              {taken ? <span style={{ fontSize: 11.5, color: "var(--muted)" }}>اتاخد بواسطة {taken.name}</span> : notYourTime ? <span style={{ fontSize: 11.5, color: "var(--muted)" }}>لسه مش وقته</span> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function DailyLedger({ rooms, perms, profile, onLog, showToast, dataVersion }) {
  const [mode, setMode] = useState(perms.editLedger ? "live" : "history");
  const [claims, setClaims] = useState(null);
  const [myShiftKey, setMyShiftKey] = useState(null);
  const [record, setRecord] = useState(null);
  const [prevClosing, setPrevClosing] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const today = todayStr();
  const [histDate, setHistDate] = useState(today);
  const [histShift, setHistShift] = useState(defaultShiftForNow());
  const [histRecord, setHistRecord] = useState(null);

  useEffect(() => {
    if (mode !== "live") return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const c = await getClaimsForDate(today);
      if (cancelled) return;
      setClaims(c);
      const mine = Object.entries(c).find(([, v]) => v && v.username === profile.username);
      if (mine) {
        const [sk] = mine;
        let rec = await getShiftRecord(today, sk);
        const prev = await getPrevShiftClosing(today, sk);
        if (!rec) {
          const fresh = freshShiftRecord(today, sk, profile.name, profile.username, rooms, prev || undefined);
          const created = await createShiftRecord(fresh);
          rec = created.data || fresh;
        }
        if (cancelled) return;
        setMyShiftKey(sk); setRecord(rec); setPrevClosing(prev);
      } else { setMyShiftKey(null); setRecord(null); }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [mode, refreshKey, dataVersion]);

  useEffect(() => {
    if (mode !== "history") return;
    let cancelled = false;
    (async () => { const r = await getShiftRecord(histDate, histShift); if (!cancelled) setHistRecord(r); })();
    return () => { cancelled = true; };
  }, [mode, histDate, histShift, dataVersion]);

  async function getPrevShiftClosing(date, shiftKey) {
    const prev = prevShiftOf(date, shiftKey);
    const rec = await getShiftRecord(prev.date, prev.shiftKey);
    if (rec && rec.closed) return rec.closingCash;
    return null;
  }

  async function claimShift(shiftKey) {
    if (shiftKey !== defaultShiftForNow()) { showToast("الشيفت ده لسه مش في ميعاده"); return; }
    const res = await claimShiftRow(today, shiftKey, profile.username, profile.name);
    if (res.conflict) { showToast("حد تاني اختار نفس الشيفت في نفس اللحظة بالظبط - اختار شيفت تاني"); setRefreshKey((k) => k + 1); return; }
    if (res.error) { showToast(res.error); return; }
    onLog(`${profile.name} اختار ${SHIFTS.find((s) => s.key === shiftKey)?.label} ليوم ${today}`);
    setRefreshKey((k) => k + 1);
  }

  async function persist(next, { silent } = {}) {
    const expected = record.updatedAt;
    setRecord(next);
    const res = await updateShiftRecordIfUnchanged(today, myShiftKey, expected, next);
    if (res.conflict) { showToast("⚠ فيه تعديل حصل من مكان تاني على نفس الشيفت - جاري تحديث البيانات"); setRefreshKey((k) => k + 1); return; }
    if (res.error) { showToast(res.error); return; }
    setRecord(res.data);
    if (!silent) showToast("تم الحفظ");
  }
  function updateRow(idx, patch) { const rows = record.rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)); persist({ ...record, rows }, { silent: true }); }
  function updateCafeteria(patch) { persist({ ...record, cafeteria: { ...record.cafeteria, ...patch } }, { silent: true }); }
  function updateHandover(cur, val) { persist({ ...record, handover: { ...record.handover, [cur]: Number(val) || 0 } }, { silent: true }); }

  const totals = record ? computeShiftTotals(record) : null;
  const locked = !record || record.closed || !perms.editLedger;

  async function closeShift() {
    const t = computeShiftTotals(record);
    const closedRecord = { ...record, closed: true, closedBy: profile.name, closedAt: Date.now(), ...t };
    const res = await updateShiftRecordIfUnchanged(today, myShiftKey, record.updatedAt, closedRecord);
    if (res.conflict) { showToast("⚠ فيه تعديل حصل من مكان تاني - جاري تحديث البيانات، جرّب تقفل تاني"); setRefreshKey((k) => k + 1); return; }
    if (res.error) { showToast(res.error); return; }
    onLog(`أقفل ${SHIFTS.find((s) => s.key === myShiftKey)?.label} ليوم ${today} — رصيد الخزينة ${money(t.closingCash, "EGP")}ج / ${money(t.closingCash, "USD")}$`);
    setRefreshKey((k) => k + 1);
  }

  function exportCSV(rec) {
    const headers = ["الغرفة", "بند", "بيان المصاريف", "مبلغ المصاريف", "عملة المصاريف", "بيان التحصيل", "مبلغ التحصيل", "عملة التحصيل", "طريقة الدفع", "اسم المرسل", "رقم المرسل", "رقم العملية", "ملاحظات"];
    const rows = [...rec.rows, { ...rec.cafeteria, room: "كافيتيريا" }].map((r) => [r.room, r.expenseCategory, r.expenseDesc, r.expenseAmt, r.expenseCurrency, r.collectionDesc, r.collectionAmt, r.collectionCurrency, r.collectionMethod, r.paymentDetails?.senderName, r.paymentDetails?.senderNumber, r.paymentDetails?.ref, r.notes]);
    downloadCSV(`ledger-${rec.date}-${rec.shiftKey}.csv`, headers, rows);
  }

  return (
    <div style={{ padding: 14 }}>
      <div className="cx-no-print" style={{ marginBottom: 10, display: "flex", gap: 8 }}>
        {perms.editLedger && <button className={"cx-btn " + (mode === "live" ? "cx-btn-gold" : "cx-btn-outline")} onClick={() => setMode("live")}>شيفتي النهارده</button>}
        <button className={"cx-btn " + (mode === "history" ? "cx-btn-gold" : "cx-btn-outline")} onClick={() => setMode("history")}><History size={14} /> استعراض شيفتات سابقة (قراءة فقط)</button>
      </div>

      {mode === "live" ? (
        loading ? <div style={{ padding: "3rem 1rem", textAlign: "center", color: "var(--muted)" }}>جارِ التحميل...</div> : !myShiftKey ? (
          <ShiftClaimPicker date={today} claims={claims || {}} onClaim={claimShift} />
        ) : (
          <>
            <div className="cx-card" style={{ padding: 12, marginBottom: 12, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <div><label style={{ fontSize: 11, color: "var(--muted)", display: "block" }}>التاريخ</label><div style={{ fontWeight: 700, fontSize: 13, padding: "6px 2px" }}>{arabicWeekday(today)} · {today}</div></div>
              <div><label style={{ fontSize: 11, color: "var(--muted)", display: "block" }}>شيفتك</label><div style={{ fontWeight: 700, fontSize: 13, padding: "6px 2px" }}>{SHIFTS.find((s) => s.key === myShiftKey)?.label} ({SHIFTS.find((s) => s.key === myShiftKey)?.time})</div></div>
              <div><label style={{ fontSize: 11, color: "var(--muted)", display: "block" }}>الاسم</label><div style={{ fontSize: 13, padding: "6px 2px" }}>{record.staffName}</div></div>
              <div>{record.closed ? <span className="cx-pill" style={{ background: "#EFEEEC", color: "#8A8577" }}><Lock size={11} style={{ verticalAlign: -1 }} /> مقفول</span> : <span className="cx-pill" style={{ background: "#EAF2EC", color: "var(--sage)" }}><Unlock size={11} style={{ verticalAlign: -1 }} /> شيفتك الوحيد المتاح ليك النهارده</span>}</div>
              <button className="cx-btn cx-btn-outline" onClick={() => exportCSV(record)}><Download size={13} /> CSV</button>
            </div>
            <LedgerTable record={record} locked={locked} onUpdateRow={updateRow} onUpdateCafeteria={updateCafeteria} />
            <div className="cx-card" style={{ marginTop: 14, padding: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <input type="checkbox" checked={record.flagged} disabled={locked} onChange={(e) => persist({ ...record, flagged: e.target.checked })} />
                <span style={{ fontSize: 13, fontWeight: 700, color: record.flagged ? "var(--rust)" : "var(--text)" }}><AlertTriangle size={13} style={{ verticalAlign: -2 }} /> فيه مشكلة تحتاج متابعة من المديرة/المدير العام</span>
              </div>
              <textarea className="cx-textarea" rows={2} placeholder="ملاحظات الشيفت" disabled={locked} value={record.shiftNotes} onChange={(e) => persist({ ...record, shiftNotes: e.target.value }, { silent: true })} />
            </div>
            <ShiftSummaryFooter record={record} totals={totals} locked={locked} onChangeHandover={updateHandover} prevClosing={prevClosing} />
            <div style={{ marginTop: 14, display: "flex", gap: 8, flexWrap: "wrap" }}>
              {!record.closed && perms.closeShift && <button className="cx-btn cx-btn-gold" onClick={closeShift}><Lock size={14} /> إقفال الشيفت</button>}
              {record.closed && <span style={{ fontSize: 12, color: "var(--muted)" }}>أُقفل بواسطة {record.closedBy} في {new Date(record.closedAt).toLocaleString("ar-EG")} — الشيفت ده خلص ومش هتقدر ترجعله تاني</span>}
            </div>
          </>
        )
      ) : (
        <>
          <div className="cx-card" style={{ padding: 12, marginBottom: 12, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <div><label style={{ fontSize: 11, color: "var(--muted)", display: "block" }}>التاريخ</label><input className="cx-input" type="date" value={histDate} onChange={(e) => setHistDate(e.target.value)} style={{ width: 150 }} /></div>
            <div style={{ display: "flex", gap: 6 }}>{SHIFTS.map((s) => <button key={s.key} onClick={() => setHistShift(s.key)} className={"cx-btn " + (histShift === s.key ? "cx-btn-gold" : "cx-btn-outline")} style={{ fontSize: 12 }}>{s.label}</button>)}</div>
          </div>
          {!histRecord ? <div style={{ color: "var(--muted)", fontSize: 13, padding: 20, textAlign: "center" }}>لا يوجد سجل لهذا الشيفت</div> : (
            <>
              <button className="cx-btn cx-btn-outline cx-no-print" style={{ marginBottom: 10 }} onClick={() => exportCSV(histRecord)}><Download size={13} /> CSV</button>
              <LedgerTable record={histRecord} locked={true} onUpdateRow={() => {}} onUpdateCafeteria={() => {}} />
              <ShiftSummaryFooter record={histRecord} totals={computeShiftTotals(histRecord)} locked={true} onChangeHandover={() => {}} prevClosing={null} />
              {histRecord.shiftNotes && <div className="cx-card" style={{ marginTop: 10, padding: 10, fontSize: 12.5 }}>ملاحظات الشيفت: {histRecord.shiftNotes}</div>}
            </>
          )}
        </>
      )}
    </div>
  );
}
