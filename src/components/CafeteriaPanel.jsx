import { useState } from "react";
import { Plus, Check, Coffee } from "lucide-react";
import { PaymentDetailsInline, SectionHead, RoomName, stackLabels } from "./shared";
import { COMMON_CURRENCIES, PAYMENT_METHODS, emptyPaymentDetails, cleanPaymentDetailsFor, validatePaymentDetailsFor, describePaymentDetails, cafeteriaOutstandingLines, fmt } from "../domain/money";
import { roomLabel } from "../domain/constants";
import { staffOwed, updateStaffCafeteriaEntry, deleteStaffCafeteriaEntry } from "../data/staffCafeteria";
import { editLedgerPaymentRow } from "../data/shifts";
import { recordStaffCafeteria, settleStaffCafeteria } from "../data/payments";
import { sanitizeText } from "../domain/security";
import { guarded } from "../lib/busy";

const MANUAL = "__manual__";
const keyOf = (name, username) => (username || String(name || "").trim().toLowerCase());

/* تحصيل الكافيتيريا التلقائي (خدمات نزلاء اتحصّلت + سداد استاف) + خدمات
   النزلاء اللي لسه عليهم فلوس + كافيتيريا الاستاف (مين أخد ومين دفع ومين عليه فلوس). */
export function CafeteriaSection({ record, rooms, bookings, onUpdateCafeteria, locked, readOnly, profile, profiles, staffEntries, onReload, flushNow, reloadRecord, onLog, showToast }) {
  // تعديل/مسح الكافيتيريا (نزلاء واستاف): المطوّر ومدير الشيفت
  const isDev = profile?.role === "dev" || profile?.role === "shift_manager";
  // المطوّر بيعدّل تحصيل الكافيتيريا (نزلاء واستاف) في اليومية المفتوحة، حتى الصفوف اللي مبلغها اتمسح (صفر) عشان ترجع
  const devRows = isDev && !readOnly;
  const rows = (record.cafeteriaRows || []).map((r, idx) => ({ ...r, _idx: idx })).filter((r) => (Number(r.collectionAmt) || 0) !== 0);   // الممسوح مابيظهرش
  const guestOutstanding = (bookings || []).filter((b) => b.status !== "ملغي" && cafeteriaOutstandingLines(b).length > 0);
  const entries = staffEntries || [];
  const open = entries.filter((e) => staffOwed(e) > 0);
  const thisShift = entries.filter((e) => e.day === record.date && e.shiftKey === record.shiftKey);
  const canWrite = !readOnly && !locked;
  // المطوّر بيشوف (ويصحّح) استهلاك الشيفت ده + أي استهلاك لسه عليه فلوس من شيفتات قبل كده
  const shownEntries = profile?.role === "dev" ? [...thisShift, ...open.filter((e) => !thisShift.some((t) => t.id === e.id))] : thisShift;

  // ---- نموذج تسجيل استهلاك
  const staffList = (profiles || []).filter((p) => p.active !== false);
  const [who, setWho] = useState("");
  const [manualName, setManualName] = useState("");
  const [desc, setDesc] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("EGP");
  const [payMode, setPayMode] = useState("later"); // later | pay
  const [method, setMethod] = useState("كاش");
  const [details, setDetails] = useState(emptyPaymentDetails());

  function resolveConsumer() {
    if (who === MANUAL) return { name: sanitizeText(manualName, 120), username: null };
    const p = staffList.find((x) => x.username === who);
    return p ? { name: p.name || p.username, username: p.username } : { name: "", username: null };
  }
  async function addConsumption() {
    return guarded("staff-cafe-add", async () => {
      const c = resolveConsumer();
      if (!c.name) { showToast("اختار اسم الموظف أو اكتب الاسم"); return; }
      const amt = Math.round((Number(amount) || 0) * 100) / 100;
      if (!(amt > 0)) { showToast("اكتب مبلغ الاستهلاك (أكبر من صفر)"); return; }
      if (payMode === "pay") { const err = validatePaymentDetailsFor(method, details); if (err) { showToast(err); return; } }
      const det = cleanPaymentDetailsFor(method, details);
      await flushNow();
      const res = await recordStaffCafeteria({
        name: c.name, username: c.username, description: sanitizeText(desc, 300), amount: amt, currency,
        method: payMode === "pay" ? method : null, details: payMode === "pay" ? det : null, devHotel: profile?.role === "dev" ? record.hotelId : null,
      });
      if (res.error) { showToast(res.error); return; }
      onLog(`كافيتيريا استاف - ${c.name}: ${fmt(amt)} ${currency}${payMode === "pay" ? ` (دفع ${method})` : " (آجل - عليه فلوس)"}`);
      const wasPay = payMode === "pay";
      setDesc(""); setAmount(""); setDetails(emptyPaymentDetails()); setPayMode("later"); setMethod("كاش");
      await reloadRecord();
      await onReload();
      showToast(wasPay ? "تم تسجيل الاستهلاك والسداد" : `تم تسجيل الاستهلاك - ${c.name} عليه ${fmt(amt)} ${currency}`);
    });
  }

  // ---- سداد مديونية موظف (بيتوزّع على أقدم استهلاك الأول)
  const groups = {};
  open.forEach((e) => { const k = keyOf(e.consumerName, e.consumerUsername) + "|" + e.currency; (groups[k] = groups[k] || { name: e.consumerName, username: e.consumerUsername, currency: e.currency, entries: [] }).entries.push(e); });
  const groupList = Object.values(groups);
  const [payFor, setPayFor] = useState(null);
  const [payAmt, setPayAmt] = useState("");
  const [payMethod, setPayMethod] = useState("كاش");
  const [payDetails, setPayDetails] = useState(emptyPaymentDetails());

  async function settle(g) {
    return guarded("staff-cafe-settle", async () => {
      const owed = g.entries.reduce((a, e) => a + staffOwed(e), 0);
      const amt = Math.round((payAmt === "" ? owed : Number(payAmt) || 0) * 100) / 100;
      if (!(amt > 0)) { showToast("اكتب مبلغ السداد"); return; }
      if (amt > owed) { showToast(`المبلغ أكبر من المديونية (${fmt(owed)} ${g.currency})`); return; }
      const err = validatePaymentDetailsFor(payMethod, payDetails); if (err) { showToast(err); return; }
      const det = cleanPaymentDetailsFor(payMethod, payDetails);
      await flushNow();
      const r = await settleStaffCafeteria({ name: g.name, username: g.username, currency: g.currency, amount: amt, method: payMethod, details: det, devHotel: profile?.role === "dev" ? record.hotelId : null });
      if (r.error) { showToast(r.error); await onReload(); return; }
      onLog(`سداد كافيتيريا استاف - ${g.name}: ${fmt(amt)} ${g.currency} (${payMethod})`);
      setPayFor(null); setPayAmt(""); setPayMethod("كاش"); setPayDetails(emptyPaymentDetails());
      await reloadRecord();
      await onReload();
      showToast(`تم تسجيل سداد ${fmt(amt)} ${g.currency} من ${g.name}${amt < owed ? ` - لسه عليه ${fmt(owed - amt)}` : " - مفيش عليه حاجة"}`);
    });
  }

  // ---- المطوّر: تعديل صف تحصيل كافيتيريا (بنفس آلية تصحيح اليومية: المدفوع على الحجز والعهدة بيتظبطوا)
  const [rowEdit, setRowEdit] = useState(null);   // { idx, amount, method }
  async function saveRow(r, remove = false) {
    return guarded("cafe-row-edit", async () => {
      const amt = remove ? 0 : Math.round((Number(rowEdit.amount) || 0) * 100) / 100;
      if (!Number.isFinite(amt) || amt < 0) { showToast("اكتب مبلغ صحيح (صفر = الدفعة اتشالت)"); return; }
      await flushNow();
      const { _idx, ...row } = r;
      const res = await editLedgerPaymentRow({ date: record.date, shiftKey: record.shiftKey, hotelId: record.hotelId, list: "cafeteriaRows", idx: _idx, row }, { collectionAmt: amt, collectionMethod: rowEdit.method, collectionCurrency: rowEdit.currency || r.collectionCurrency || "EGP" });
      if (res.error) { showToast(res.error); return; }
      onLog(`تعديل تحصيل كافيتيريا (${r.kind === "staff" ? "استاف" : "نزيل"} - ${r.who || "—"}): ${fmt(r.collectionAmt)} ${r.collectionCurrency} ← ${remove ? "اتمسح" : `${fmt(amt)} ${rowEdit.currency || r.collectionCurrency} (${rowEdit.method})`}`);
      setRowEdit(null);
      await reloadRecord();
      await onReload();
      showToast((remove ? "اتمسح تحصيل الكافيتيريا" : "تم تعديل تحصيل الكافيتيريا") + (r.kind === "staff" ? " - لو عايز المديونية على الموظف تتظبط عدّل استهلاكه تحت" : ""));
    });
  }
  // ---- المطوّر: تصحيح/مسح استهلاك استاف
  const [entryEdit, setEntryEdit] = useState(null);   // { id, description, amount }
  async function saveEntry(e) {
    return guarded("staff-cafe-fix", async () => {
      const amt = Math.round((Number(entryEdit.amount) || 0) * 100) / 100;
      if (!(amt > 0)) { showToast("المبلغ لازم يكون أكبر من صفر (أو امسح الاستهلاك)"); return; }
      if (amt < (Number(e.paidAmount) || 0)) { showToast(`المبلغ مايقلّش عن اللي اتدفع (${fmt(e.paidAmount)} ${e.currency})`); return; }
      const r = await updateStaffCafeteriaEntry(e.id, { description: sanitizeText(entryEdit.description, 300), amount: amt });
      if (r.error) { showToast(r.error); return; }
      onLog(`تصحيح كافيتيريا استاف - ${e.consumerName}: ${fmt(e.amount)} ← ${fmt(amt)} ${e.currency}`);
      setEntryEdit(null); await onReload(); showToast("تم تعديل الاستهلاك");
    });
  }
  async function removeEntry(e) {
    return guarded("staff-cafe-del", async () => {
      if ((Number(e.paidAmount) || 0) > 0) { showToast("الاستهلاك ده عليه سداد متسجّل في اليومية - عدّل مبلغ السداد في تحصيل الكافيتيريا الأول"); return; }
      const r = await deleteStaffCafeteriaEntry(e.id);
      if (r.error) { showToast(r.error); return; }
      onLog(`مسح استهلاك كافيتيريا استاف - ${e.consumerName}: ${fmt(e.amount)} ${e.currency}`);
      setEntryEdit(null); await onReload(); showToast("اتمسح الاستهلاك");
    });
  }

  const dc = record.cafeteria || {};
  const directHasData = (Number(dc.expenseAmt) || 0) !== 0 || (Number(dc.collectionAmt) || 0) !== 0 || !!dc.expenseDesc || !!dc.collectionDesc || !!dc.notes;
  const hasAnything = directHasData || rows.length > 0 || guestOutstanding.length > 0 || open.length > 0 || thisShift.length > 0 || canWrite;
  if (!hasAnything) return null;

  return (
    <div className="cx-card" data-testid="cafeteria-section" style={{ marginTop: 14, padding: 14 }}>
      <SectionHead icon={Coffee} tone="rose" title="الكافيتيريا" hint="خدمات الكافيتيريا اللي بتتحصّل من النزلاء وسداد الاستاف بيتسجّلوا هنا لوحدهم بوسيلة الدفع وتفاصيلها، وبيدخلوا إجمالي اليومية وعهدة الفيزا والتقرير. الكافيتيريا مابتصرفش." />


      {/* خانة المبيعات/المصاريف المباشرة اتشالت: الكافيتيريا مابتصرفش، وخدمات النزلاء والاستاف بتتسجّل هنا لوحدها.
          لو يومية قديمة فيها أرقام في الخانة دي بتتعرض للعلم بس (وبتفضل محسوبة في الإجماليات). */}
      {directHasData && (
        <div data-testid="cafeteria-direct-legacy" style={{ marginBottom: 10, fontSize: 12.5, color: "var(--muted)" }}>
          مسجّل قبل كده في خانة الكافيتيريا المباشرة:
          {(Number(dc.collectionAmt) || 0) !== 0 && <> تحصيل {dc.collectionDesc ? `(${dc.collectionDesc}) ` : ""}{fmt(dc.collectionAmt)} {dc.collectionCurrency || "EGP"}</>}
          {(Number(dc.expenseAmt) || 0) !== 0 && <> · مصروف {dc.expenseDesc ? `(${dc.expenseDesc}) ` : ""}{fmt(dc.expenseAmt)} {dc.expenseCurrency || "EGP"}</>}
          {dc.notes ? <> · {dc.notes}</> : null}
        </div>
      )}
      {rows.length > 0 && (
        <div style={{ overflowX: "auto", marginBottom: 10 }}>
          <table ref={stackLabels} className="cx-table cx-stack" data-testid="cafeteria-rows" style={{ fontSize: 13, minWidth: 620 }}>
            <thead><tr><th className="cx-th">النوع</th><th className="cx-th">الجهة</th><th className="cx-th">الوسيلة</th><th className="cx-th">تفاصيل الدفع</th><th className="cx-th">المبلغ</th>{devRows && <th className="cx-th cx-no-print">تعديل</th>}</tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} data-testid="cafeteria-row">
                  <td>{r.kind === "staff" ? "استاف" : `نزيل${r.guestRoom ? " - " + roomLabel(rooms, r.guestRoom) : ""}`}</td>
                  <td>{r.who || "—"}</td>
                  <td>{r.collectionMethod}</td>
                  <td dir="ltr" style={{ textAlign: "right" }}>{describePaymentDetails(r.collectionMethod, r.paymentDetails) || "—"}</td>
                  <td style={{ fontWeight: 700 }}>{fmt(r.collectionAmt)} {r.collectionCurrency}</td>
                  {devRows && (
                    <td className="cx-no-print">
                      {rowEdit?.idx === r._idx ? (
                        <span style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                          <input className="cx-input" data-testid="cafe-row-amount" type="number" min="0" style={{ width: 90 }} value={rowEdit.amount} onChange={(e) => setRowEdit({ ...rowEdit, amount: e.target.value })} />
                          <select className="cx-select" aria-label="طريقة الدفع" style={{ width: 90 }} value={rowEdit.method} onChange={(e) => setRowEdit({ ...rowEdit, method: e.target.value })}>{PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}</select>
                          <select className="cx-select" aria-label="العملة" data-testid="cafe-row-currency" style={{ width: 80 }} value={rowEdit.currency} onChange={(e) => setRowEdit({ ...rowEdit, currency: e.target.value })}>{COMMON_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}</select>
                          <button className="cx-btn cx-btn-gold" data-testid="cafe-row-save" style={{ fontSize: 12.5, padding: "3px 8px" }} onClick={() => saveRow(r)}>حفظ</button>
                          <button className="cx-btn cx-btn-outline" data-testid="cafe-row-delete" style={{ fontSize: 12.5, padding: "3px 8px", color: "var(--rust)" }} onClick={() => saveRow(r, true)}>مسح</button>
                          <button className="cx-btn cx-btn-outline" style={{ fontSize: 12.5, padding: "3px 8px" }} onClick={() => setRowEdit(null)}>إلغاء</button>
                        </span>
                      ) : <button className="cx-btn cx-btn-outline" data-testid="cafe-row-edit" style={{ fontSize: 12.5, padding: "3px 8px" }} onClick={() => setRowEdit({ idx: r._idx, amount: String(Number(r.collectionAmt) || 0), method: r.collectionMethod || "كاش", currency: r.collectionCurrency || "EGP" })}>تعديل</button>}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {guestOutstanding.length > 0 && (
        <div data-testid="cafeteria-guest-due" style={{ fontSize: 13, background: "var(--paper2)", borderRadius: 8, padding: 8, marginBottom: 10 }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>خدمات كافيتيريا على نزلاء لسه ماتحصّلتش</div>
          {guestOutstanding.map((b) => <div key={b.id}><RoomName rooms={rooms} number={b.room} /> · <span className="cx-iso">{b.guestName}</span>: <bdi dir="ltr">{cafeteriaOutstandingLines(b).map((l) => `${fmt(l.due)} ${l.currency}`).join(" + ")}</bdi></div>)}
        </div>
      )}

      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6 }}>كافيتيريا الاستاف</div>
      {canWrite && (
        <div data-testid="staff-cafe-form" className="cx-no-print" style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "flex-start", marginBottom: 10 }}>
          <select className="cx-select" data-testid="staff-cafe-who" style={{ width: 150 }} value={who} onChange={(e) => setWho(e.target.value)}>
            <option value="">مين أخد؟</option>
            {staffList.map((p) => <option key={p.username} value={p.username}>{p.name || p.username}</option>)}
            <option value={MANUAL}>اسم تاني...</option>
          </select>
          {who === MANUAL && <input className="cx-input" data-testid="staff-cafe-manual" style={{ width: 130 }} placeholder="الاسم" value={manualName} onChange={(e) => setManualName(e.target.value)} />}
          <input className="cx-input" data-testid="staff-cafe-desc" style={{ width: 150 }} placeholder="أخد إيه (اختياري)" value={desc} onChange={(e) => setDesc(e.target.value)} />
          <input className="cx-input" data-testid="staff-cafe-amount" type="number" min="0" style={{ width: 90 }} placeholder="المبلغ" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <select className="cx-select" style={{ width: 80 }} value={currency} onChange={(e) => setCurrency(e.target.value)}>{COMMON_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}</select>
          <select className="cx-select" data-testid="staff-cafe-paymode" style={{ width: 150 }} value={payMode === "later" ? "later" : method} onChange={(e) => { if (e.target.value === "later") setPayMode("later"); else { setPayMode("pay"); setMethod(e.target.value); setDetails(emptyPaymentDetails()); } }}>
            <option value="later">لسه مادفعش (عليه فلوس)</option>
            {PAYMENT_METHODS.map((m) => <option key={m} value={m}>دفع {m}</option>)}
          </select>
          {payMode === "pay" && <PaymentDetailsInline compact={false} testid="staff-cafe" method={method} details={details} onChange={setDetails} />}
          <button className="cx-btn cx-btn-gold" data-testid="staff-cafe-add" style={{ fontSize: 13 }} onClick={addConsumption}><Plus size={13} /> تسجيل</button>
        </div>
      )}

      {shownEntries.length > 0 && (
        <div style={{ overflowX: "auto", marginBottom: 10 }}>
          <table ref={stackLabels} className="cx-table cx-stack" data-testid="staff-cafe-shift" style={{ fontSize: 13, minWidth: 520 }}>
            <thead><tr><th className="cx-th">الموظف</th><th className="cx-th">البيان</th><th className="cx-th">المبلغ</th><th className="cx-th">اتدفع</th><th className="cx-th">الباقي عليه</th>{isDev && <th className="cx-th cx-no-print">تعديل</th>}</tr></thead>
            <tbody>{shownEntries.map((e) => (
              <tr key={e.id} data-testid="staff-cafe-entry"><td>{e.consumerName}{isDev && e.day !== record.date ? <span style={{ fontSize: 11.5, color: "var(--muted)" }}> ({e.day})</span> : null}</td>
                <td>{entryEdit?.id === e.id ? <input className="cx-input" data-testid="staff-cafe-fix-desc" style={{ width: 140 }} value={entryEdit.description} onChange={(ev) => setEntryEdit({ ...entryEdit, description: ev.target.value })} /> : (e.description || "—")}</td>
                <td>{entryEdit?.id === e.id ? <input className="cx-input" data-testid="staff-cafe-fix-amount" type="number" min="0" style={{ width: 90 }} value={entryEdit.amount} onChange={(ev) => setEntryEdit({ ...entryEdit, amount: ev.target.value })} /> : <>{fmt(e.amount)} {e.currency}</>}</td>
                <td>{fmt(e.paidAmount)}</td><td style={{ fontWeight: 700, color: staffOwed(e) > 0 ? "var(--rust)" : "var(--sage)" }}>{staffOwed(e) > 0 ? `${fmt(staffOwed(e))} ${e.currency}` : "مسدّد"}</td>
                {isDev && (
                  <td className="cx-no-print">
                    {entryEdit?.id === e.id ? (
                      <span style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                        <button className="cx-btn cx-btn-gold" data-testid="staff-cafe-fix-save" style={{ fontSize: 12.5, padding: "3px 8px" }} onClick={() => saveEntry(e)}>حفظ</button>
                        {!(Number(e.paidAmount) > 0) && <button className="cx-btn cx-btn-outline" data-testid="staff-cafe-fix-delete" style={{ fontSize: 12.5, padding: "3px 8px", color: "var(--rust)" }} onClick={() => removeEntry(e)}>مسح</button>}
                        <button className="cx-btn cx-btn-outline" style={{ fontSize: 12.5, padding: "3px 8px" }} onClick={() => setEntryEdit(null)}>إلغاء</button>
                      </span>
                    ) : <button className="cx-btn cx-btn-outline" data-testid="staff-cafe-fix" style={{ fontSize: 12.5, padding: "3px 8px" }} onClick={() => setEntryEdit({ id: e.id, description: e.description || "", amount: String(e.amount) })}>تعديل</button>}
                  </td>
                )}
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}

      {groupList.length > 0 && (
        <div data-testid="staff-cafe-balances" style={{ border: "1px solid var(--rust)", borderRadius: 8, padding: 8 }}>
          <div style={{ fontWeight: 700, fontSize: 13.5, color: "var(--rust)", marginBottom: 6 }}>استاف عليهم فلوس للكافيتيريا ({groupList.length})</div>
          {groupList.map((g) => {
            const k = g.name + "|" + g.currency; const owed = g.entries.reduce((a, e) => a + staffOwed(e), 0);
            return (
              <div key={k} data-testid="staff-cafe-balance" style={{ borderBottom: "1px solid var(--hair)", padding: "6px 0" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", alignItems: "center", fontSize: 13.5 }}>
                  <span><b>{g.name}</b> <span style={{ color: "var(--muted)", fontSize: 12.5 }}>({g.entries.length} استهلاك: {g.entries.map((e) => e.description || e.day).slice(0, 3).join("، ")})</span></span>
                  <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <b style={{ color: "var(--rust)" }}>{fmt(owed)} {g.currency}</b>
                    {canWrite && <button className="cx-btn cx-btn-outline cx-no-print" data-testid="staff-cafe-settle-open" style={{ fontSize: 12.5, padding: "3px 8px" }} onClick={() => { setPayFor(payFor === k ? null : k); setPayAmt(""); }}>تسديد</button>}
                  </span>
                </div>
                {payFor === k && canWrite && (
                  <div className="cx-no-print" style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "flex-start", marginTop: 6 }}>
                    <input className="cx-input" data-testid="staff-cafe-pay-amount" type="number" min="0" style={{ width: 110 }} placeholder={`المبلغ (${fmt(owed)})`} value={payAmt} onChange={(e) => setPayAmt(e.target.value)} />
                    <select className="cx-select" data-testid="staff-cafe-pay-method" style={{ width: 140 }} value={payMethod} onChange={(e) => { setPayMethod(e.target.value); setPayDetails(emptyPaymentDetails()); }}>{PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}</select>
                    <PaymentDetailsInline compact={false} testid="staff-cafe-pay" method={payMethod} details={payDetails} onChange={setPayDetails} />
                    <button className="cx-btn cx-btn-gold" data-testid="staff-cafe-pay-go" style={{ fontSize: 13 }} onClick={() => settle(g)}><Check size={13} /> تسجيل السداد</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {groupList.length === 0 && entries.length > 0 && <div style={{ fontSize: 13, color: "var(--sage)" }}>مفيش استاف عليه فلوس للكافيتيريا دلوقتي.</div>}
    </div>
  );
}
