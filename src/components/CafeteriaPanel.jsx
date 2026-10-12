import React, { useState } from "react";
import { Plus, Check } from "lucide-react";
import { PaymentDetailsInline } from "./shared";
import { COMMON_CURRENCIES, PAYMENT_METHODS, EXPENSE_CATEGORIES, methodOptionsFor, emptyPaymentDetails, cleanPaymentDetailsFor, validatePaymentDetailsFor, describePaymentDetails, cafeteriaOutstanding, fmt } from "../domain/money";
import { roomLabel } from "../domain/constants";
import { staffOwed } from "../data/staffCafeteria";
import { recordStaffCafeteria, settleStaffCafeteria } from "../data/payments";
import { sanitizeText } from "../domain/security";
import { guarded } from "../lib/busy";

const MANUAL = "__manual__";
const keyOf = (name, username) => (username || String(name || "").trim().toLowerCase());

/* تحصيل الكافيتيريا التلقائي (خدمات نزلاء اتحصّلت + سداد استاف) + خدمات
   النزلاء اللي لسه عليهم فلوس + كافيتيريا الاستاف (مين أخد ومين دفع ومين عليه فلوس). */
export function CafeteriaSection({ record, rooms, bookings, onUpdateCafeteria, locked, readOnly, profile, profiles, staffEntries, onReload, flushNow, reloadRecord, onLog, showToast }) {
  const rows = (record.cafeteriaRows || []).filter((r) => (Number(r.collectionAmt) || 0) !== 0);
  const guestOutstanding = (bookings || []).filter((b) => b.status !== "ملغي" && cafeteriaOutstanding(b) > 0);
  const entries = staffEntries || [];
  const open = entries.filter((e) => staffOwed(e) > 0);
  const thisShift = entries.filter((e) => e.day === record.date && e.shiftKey === record.shiftKey);
  const canWrite = !readOnly && !locked;

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
        method: payMode === "pay" ? method : null, details: payMode === "pay" ? det : null,
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
      const r = await settleStaffCafeteria({ name: g.name, username: g.username, currency: g.currency, amount: amt, method: payMethod, details: det });
      if (r.error) { showToast(r.error); await onReload(); return; }
      onLog(`سداد كافيتيريا استاف - ${g.name}: ${fmt(amt)} ${g.currency} (${payMethod})`);
      const usedMethod = payMethod;
      setPayFor(null); setPayAmt(""); setPayMethod("كاش"); setPayDetails(emptyPaymentDetails());
      await reloadRecord();
      await onReload();
      showToast(`تم تسجيل سداد ${fmt(amt)} ${g.currency} من ${g.name}${amt < owed ? ` - لسه عليه ${fmt(owed - amt)}` : " - مفيش عليه حاجة"}`);
    });
  }

  const dc = record.cafeteria || {};
  const directHasData = (Number(dc.expenseAmt) || 0) !== 0 || (Number(dc.collectionAmt) || 0) !== 0 || !!dc.expenseDesc || !!dc.collectionDesc || !!dc.notes;
  const hasAnything = directHasData || rows.length > 0 || guestOutstanding.length > 0 || open.length > 0 || thisShift.length > 0 || canWrite;
  if (!hasAnything) return null;

  return (
    <div className="cx-card" data-testid="cafeteria-section" style={{ marginTop: 14, padding: 12 }}>
      <div style={{ fontWeight: 800, marginBottom: 2 }}>الكافيتيريا</div>
      <div style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 8 }}>خدمات الكافيتيريا اللي بتتحصّل من النزلاء وسداد الاستاف بيتسجّلوا هنا لوحدهم بوسيلة الدفع وتفاصيلها، وبيدخلوا إجمالي اليومية وعهدة الفيزا والتقرير.</div>


      {(canWrite || directHasData) && (
        <div data-testid="cafeteria-direct" style={{ marginBottom: 12, paddingBottom: 10, borderBottom: "1px dashed var(--hair)" }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 2 }}>مبيعات ومصاريف الكافيتيريا المباشرة</div>
          <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>اللي بيتباع في الكافيتيريا لنزيل خارجي أو بيتصرف عليها (خامات...) - مش المرتبط بحجز ولا باستاف.</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: 10 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              <div style={{ fontSize: 11, color: "var(--muted)" }}>مصروف</div>
              <select className="cx-select" style={{ fontSize: 11 }} disabled={!canWrite} value={dc.expenseCategory || "أخرى"} onChange={(e) => onUpdateCafeteria({ expenseCategory: e.target.value })}>{EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}</select>
              <input className="cx-input" placeholder="البيان" disabled={!canWrite} value={dc.expenseDesc || ""} onChange={(e) => onUpdateCafeteria({ expenseDesc: e.target.value })} />
              <div style={{ display: "flex", gap: 3 }}>
                <input className="cx-input" type="number" placeholder="المبلغ" disabled={!canWrite} value={dc.expenseAmt ?? ""} onChange={(e) => onUpdateCafeteria({ expenseAmt: e.target.value })} style={{ flex: 1 }} />
                <select className="cx-select" disabled={!canWrite} value={dc.expenseCurrency || "EGP"} onChange={(e) => onUpdateCafeteria({ expenseCurrency: e.target.value })} style={{ width: 72, fontSize: 12 }}>{COMMON_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}</select>
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              <div style={{ fontSize: 11, color: "var(--muted)" }}>تحصيل (مبيعات)</div>
              <select className="cx-select" disabled={!canWrite} value={dc.collectionMethod || "كاش"} onChange={(e) => onUpdateCafeteria({ collectionMethod: e.target.value, paymentDetails: emptyPaymentDetails() })}>{methodOptionsFor(dc.collectionMethod || "كاش").map((m) => <option key={m} value={m}>{m}</option>)}</select>
              <input className="cx-input" placeholder="بيان التحصيل" disabled={!canWrite} value={dc.collectionDesc || ""} onChange={(e) => onUpdateCafeteria({ collectionDesc: e.target.value })} />
              <div style={{ display: "flex", gap: 3 }}>
                <input className="cx-input" type="number" placeholder="المبلغ" disabled={!canWrite} value={dc.collectionAmt ?? ""} onChange={(e) => onUpdateCafeteria({ collectionAmt: e.target.value })} style={{ flex: 1 }} />
                <select className="cx-select" disabled={!canWrite} value={dc.collectionCurrency || "EGP"} onChange={(e) => onUpdateCafeteria({ collectionCurrency: e.target.value })} style={{ width: 72, fontSize: 12 }}>{COMMON_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}</select>
              </div>
              <PaymentDetailsInline compact={false} testid="cafe-direct" method={dc.collectionMethod || "كاش"} details={dc.paymentDetails} disabled={!canWrite} onChange={(d) => onUpdateCafeteria({ paymentDetails: d })} />
            </div>
          </div>
          <input className="cx-input" placeholder="ملاحظات الكافيتيريا" disabled={!canWrite} value={dc.notes || ""} onChange={(e) => onUpdateCafeteria({ notes: e.target.value })} style={{ marginTop: 6 }} />
        </div>
      )}
      {rows.length > 0 && (
        <div style={{ overflowX: "auto", marginBottom: 10 }}>
          <table className="cx-table" data-testid="cafeteria-rows" style={{ fontSize: 12, minWidth: 620 }}>
            <thead><tr><th className="cx-th">النوع</th><th className="cx-th">الجهة</th><th className="cx-th">الوسيلة</th><th className="cx-th">تفاصيل الدفع</th><th className="cx-th">المبلغ</th></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td>{r.kind === "staff" ? "استاف" : `نزيل${r.guestRoom ? " - " + roomLabel(rooms, r.guestRoom) : ""}`}</td>
                  <td>{r.who || "—"}</td>
                  <td>{r.collectionMethod}</td>
                  <td dir="ltr" style={{ textAlign: "right" }}>{describePaymentDetails(r.collectionMethod, r.paymentDetails) || "—"}</td>
                  <td style={{ fontWeight: 700 }}>{fmt(r.collectionAmt)} {r.collectionCurrency}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {guestOutstanding.length > 0 && (
        <div data-testid="cafeteria-guest-due" style={{ fontSize: 12, background: "var(--paper2)", borderRadius: 8, padding: 8, marginBottom: 10 }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>خدمات كافيتيريا على نزلاء لسه ماتحصّلتش</div>
          {guestOutstanding.map((b) => <div key={b.id}>{roomLabel(rooms, b.room)} · {b.guestName}: {fmt(cafeteriaOutstanding(b))} {b.currency}</div>)}
        </div>
      )}

      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>كافيتيريا الاستاف</div>
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
          <button className="cx-btn cx-btn-gold" data-testid="staff-cafe-add" style={{ fontSize: 12 }} onClick={addConsumption}><Plus size={13} /> تسجيل</button>
        </div>
      )}

      {thisShift.length > 0 && (
        <div style={{ overflowX: "auto", marginBottom: 10 }}>
          <table className="cx-table" data-testid="staff-cafe-shift" style={{ fontSize: 12, minWidth: 520 }}>
            <thead><tr><th className="cx-th">الموظف</th><th className="cx-th">البيان</th><th className="cx-th">المبلغ</th><th className="cx-th">اتدفع</th><th className="cx-th">الباقي عليه</th></tr></thead>
            <tbody>{thisShift.map((e) => (
              <tr key={e.id}><td>{e.consumerName}</td><td>{e.description || "—"}</td><td>{fmt(e.amount)} {e.currency}</td><td>{fmt(e.paidAmount)}</td><td style={{ fontWeight: 700, color: staffOwed(e) > 0 ? "var(--rust)" : "var(--sage)" }}>{staffOwed(e) > 0 ? `${fmt(staffOwed(e))} ${e.currency}` : "مسدّد"}</td></tr>
            ))}</tbody>
          </table>
        </div>
      )}

      {groupList.length > 0 && (
        <div data-testid="staff-cafe-balances" style={{ border: "1px solid var(--rust)", borderRadius: 8, padding: 8 }}>
          <div style={{ fontWeight: 700, fontSize: 12.5, color: "var(--rust)", marginBottom: 6 }}>استاف عليهم فلوس للكافيتيريا ({groupList.length})</div>
          {groupList.map((g) => {
            const k = g.name + "|" + g.currency; const owed = g.entries.reduce((a, e) => a + staffOwed(e), 0);
            return (
              <div key={k} data-testid="staff-cafe-balance" style={{ borderBottom: "1px solid var(--hair)", padding: "6px 0" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", alignItems: "center", fontSize: 12.5 }}>
                  <span><b>{g.name}</b> <span style={{ color: "var(--muted)", fontSize: 11 }}>({g.entries.length} استهلاك: {g.entries.map((e) => e.description || e.day).slice(0, 3).join("، ")})</span></span>
                  <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <b style={{ color: "var(--rust)" }}>{fmt(owed)} {g.currency}</b>
                    {canWrite && <button className="cx-btn cx-btn-outline cx-no-print" data-testid="staff-cafe-settle-open" style={{ fontSize: 11, padding: "3px 8px" }} onClick={() => { setPayFor(payFor === k ? null : k); setPayAmt(""); }}>تسديد</button>}
                  </span>
                </div>
                {payFor === k && canWrite && (
                  <div className="cx-no-print" style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "flex-start", marginTop: 6 }}>
                    <input className="cx-input" data-testid="staff-cafe-pay-amount" type="number" min="0" style={{ width: 110 }} placeholder={`المبلغ (${fmt(owed)})`} value={payAmt} onChange={(e) => setPayAmt(e.target.value)} />
                    <select className="cx-select" data-testid="staff-cafe-pay-method" style={{ width: 140 }} value={payMethod} onChange={(e) => { setPayMethod(e.target.value); setPayDetails(emptyPaymentDetails()); }}>{PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}</select>
                    <PaymentDetailsInline compact={false} testid="staff-cafe-pay" method={payMethod} details={payDetails} onChange={setPayDetails} />
                    <button className="cx-btn cx-btn-gold" data-testid="staff-cafe-pay-go" style={{ fontSize: 12 }} onClick={() => settle(g)}><Check size={13} /> تسجيل السداد</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {groupList.length === 0 && entries.length > 0 && <div style={{ fontSize: 12, color: "var(--sage)" }}>مفيش استاف عليه فلوس للكافيتيريا دلوقتي.</div>}
    </div>
  );
}
