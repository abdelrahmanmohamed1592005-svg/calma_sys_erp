import React, { useState, useEffect } from "react";
import Papa from "papaparse";
import { Pencil, Trash2, AlertTriangle, Check, Plus, Upload, Download, Lock } from "lucide-react";
import { TwoStepButton, PaymentDetailsInline, downloadCSV } from "./shared";
import { fmt, CURRENCIES, PAYMENT_METHODS, ONLINE_METHODS, emptyPaymentDetails, bookingGrandTotal } from "../domain/money";
import { todayStr, addDays, nightsBetween, uid } from "../domain/dates";
import { BOOKING_SOURCES, BOOKING_STATUSES, OTA_SOURCES } from "../domain/constants";
import { roomsOverlap, classifyBookingAgainstSet } from "../domain/bookingLogic";
import { buildImportDraft } from "../domain/importLogic";

function emptyBooking() {
  return { id: uid(), code: "", room: "", guestName: "", phone: "", pax: 1, checkin: todayStr(), checkout: addDays(todayStr(), 1), priceNight: "", currency: "USD", totalRoom: "", extras: { laundry: "", cafeteria: "", tours: "", pickup: "" }, earlyCheckin: { applied: false, fee: "", note: "" }, paymentMethod: "كاش", paymentDetails: emptyPaymentDetails(), amountPaid: "", amountTendered: "", source: "مباشر", status: "مؤكد", approvalStatus: "approved", settled: false, notes: "", imported: false, needsRoomReview: false, duplicateConfirmed: false };
}

export function BookingsPanel({ rooms, bookings, perms, role, onInsertBooking, onUpdateBooking, onDeleteBooking, onLog, showToast, pendingEditId, onConsumeEditRequest }) {
  const [form, setForm] = useState(null);
  const [filter, setFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [importPreview, setImportPreview] = useState(null);

  useEffect(() => {
    if (pendingEditId) {
      const b = bookings.find((x) => x.id === pendingEditId);
      if (b) setForm({ ...b, extras: b.extras || { laundry: "", cafeteria: "", tours: "", pickup: "" }, earlyCheckin: b.earlyCheckin || { applied: false, fee: "", note: "" }, paymentDetails: b.paymentDetails || emptyPaymentDetails(), duplicateConfirmed: false });
      onConsumeEditRequest();
    }
  }, [pendingEditId]);

  function startNew() { setForm(emptyBooking()); }
  function startEdit(b) { setForm({ ...b, extras: b.extras || { laundry: "", cafeteria: "", tours: "", pickup: "" }, earlyCheckin: b.earlyCheckin || { applied: false, fee: "", note: "" }, paymentDetails: b.paymentDetails || emptyPaymentDetails(), duplicateConfirmed: false }); }

  const isExistingBooking = form ? bookings.some((b) => b.id === form.id) : false;
  const originalBooking = form && isExistingBooking ? bookings.find((b) => b.id === form.id) : null;
  const moneyLocked = role === "reservations" && isExistingBooking && originalBooking?.approvalStatus !== "pending";

  function onRoomChange(roomNum) { const r = rooms.find((x) => x.number === Number(roomNum)); setForm((f) => ({ ...f, room: Number(roomNum), priceNight: moneyLocked ? f.priceNight : (r ? r.price : f.priceNight), currency: moneyLocked ? f.currency : (r ? r.currency : f.currency) })); }

  const nights = form ? nightsBetween(form.checkin, form.checkout) : 0;
  const autoTotalRoom = form ? (Number(form.priceNight) || 0) * nights : 0;
  const earlyFee = form && form.earlyCheckin?.applied ? Number(form.earlyCheckin.fee) || 0 : 0;
  const grandTotal = form ? (Number(form.totalRoom || autoTotalRoom) || 0) + (Number(form.extras.laundry) || 0) + (Number(form.extras.cafeteria) || 0) + (Number(form.extras.tours) || 0) + (Number(form.extras.pickup) || 0) + earlyFee : 0;
  const balanceDue = form ? grandTotal - (Number(form.amountPaid) || 0) : 0;
  const changeDue = form && form.paymentMethod === "كاش" && form.amountTendered !== "" ? (Number(form.amountTendered) || 0) - grandTotal : null;
  const conflict = form && form.room && roomsOverlap(bookings, Number(form.room), form.checkin, form.checkout, form.id);

  async function saveBooking() {
    if (!form.room || !form.guestName.trim()) { showToast("لازم تحدد الغرفة واسم النزيل"); return; }
    if (conflict && !form.duplicateConfirmed) { showToast('الغرفة متعارضة مع حجز موجود - لو ده تسكين مكرر شرعي فعّل تأكيد "تسكين مكرر" تحت'); return; }
    let cleaned = { ...form, room: Number(form.room), totalRoom: form.totalRoom !== "" ? Number(form.totalRoom) : autoTotalRoom, needsRoomReview: false };
    if (moneyLocked && originalBooking) {
      cleaned = { ...cleaned, priceNight: originalBooking.priceNight, currency: originalBooking.currency, totalRoom: originalBooking.totalRoom, extras: originalBooking.extras, earlyCheckin: originalBooking.earlyCheckin, paymentMethod: originalBooking.paymentMethod, paymentDetails: originalBooking.paymentDetails, amountPaid: originalBooking.amountPaid, amountTendered: originalBooking.amountTendered, settled: originalBooking.settled };
    }
    if (!isExistingBooking && role === "staff") cleaned.approvalStatus = "pending";
    const res = isExistingBooking ? await onUpdateBooking(cleaned.id, cleaned) : await onInsertBooking(cleaned);
    if (res?.error) { showToast(res.error); return; }
    onLog(`${isExistingBooking ? "تعديل" : "إضافة"} حجز غرفة ${cleaned.room} — ${cleaned.guestName}${conflict ? " (تسكين مكرر معتمد يدويًا)" : ""}${cleaned.approvalStatus === "pending" ? " - بانتظار موافقة مدير الحجوزات" : ""}`);
    setForm(null); showToast(cleaned.approvalStatus === "pending" ? "اتبعت لمدير الحجوزات للموافقة" : "تم الحفظ");
  }
  async function removeBooking(id) { const b = bookings.find((x) => x.id === id); const res = await onDeleteBooking(id); if (res?.error) { showToast(res.error); return; } onLog(`حذف حجز غرفة ${b?.room} — ${b?.guestName}`); showToast("تم الحذف"); }
  async function approveBooking(b) { const res = await onUpdateBooking(b.id, { ...b, approvalStatus: "approved" }); if (res?.error) { showToast(res.error); return; } onLog(`موافقة على حجز مباشر - غرفة ${b.room} — ${b.guestName}`); showToast("تمت الموافقة"); }
  async function rejectBooking(b) { const res = await onUpdateBooking(b.id, { ...b, approvalStatus: "approved", status: "ملغي" }); if (res?.error) { showToast(res.error); return; } onLog(`رفض حجز مباشر - غرفة ${b.room} — ${b.guestName}`); showToast("تم الرفض"); }

  function onFileSelected(e) {
    const file = e.target.files[0]; if (!file) return;
    Papa.parse(file, { header: true, skipEmptyLines: true, complete: (res) => {
      const workingSet = [...bookings];
      const drafts = res.data.map((row, idx) => {
        const draft = buildImportDraft(row, idx, rooms, workingSet);
        const cls = classifyBookingAgainstSet(draft, workingSet);
        const finalDraft = { ...draft, ...cls, excluded: cls.matchType === "conflict" };
        if (cls.matchType === "update") { const i = workingSet.findIndex((b) => b.id === cls.matchedExistingId); if (i >= 0) workingSet[i] = { ...workingSet[i], ...finalDraft, id: cls.matchedExistingId }; }
        else if (cls.matchType === "new") { workingSet.push(finalDraft); }
        return finalDraft;
      });
      setImportPreview(drafts);
    } });
    e.target.value = "";
  }
  function updateImportRow(idx, patch) {
    setImportPreview((prev) => {
      const draft = { ...prev[idx], ...patch };
      const others = prev.filter((_, i) => i !== idx && prev[i].matchType !== "conflict");
      const cls = classifyBookingAgainstSet(draft, [...bookings, ...others]);
      const updated = { ...draft, ...cls, excluded: cls.matchType === "conflict" ? true : draft.excluded, needsRoomReview: cls.matchType === "conflict" };
      const next = [...prev]; next[idx] = updated; return next;
    });
  }
  async function confirmImport() {
    const rowsToApply = importPreview.filter((r) => !r.excluded && r.room);
    if (rowsToApply.length === 0) { showToast("مفيش صفوف صالحة للاستيراد"); return; }
    let added = 0, updated = 0;
    for (const row of rowsToApply) {
      if (row.matchType === "update" && row.matchedExistingId) { await onUpdateBooking(row.matchedExistingId, { ...row, id: row.matchedExistingId }); updated++; }
      else { await onInsertBooking({ ...row, id: uid() }); added++; }
    }
    onLog(`استيراد CSV: ${added} حجز جديد، ${updated} حجز اتحدّث`);
    setImportPreview(null); showToast(`تم: ${added} جديد + ${updated} تحديث`);
  }

  const list = bookings.filter((b) => {
    if (filter && !String(b.room).includes(filter) && !b.guestName.includes(filter) && !(b.code && b.code.includes(filter))) return false;
    if (dateFrom && b.checkout <= dateFrom) return false;
    if (dateTo && b.checkin > dateTo) return false;
    return true;
  }).sort((a, b) => b.checkin.localeCompare(a.checkin));
  const needsReviewCount = bookings.filter((b) => b.needsRoomReview).length;
  const pendingBookings = bookings.filter((b) => b.approvalStatus === "pending" && b.status !== "ملغي");

  function exportCSV() {
    const headers = ["كود", "الغرفة", "النزيل", "الهاتف", "دخول", "خروج", "الليالي", "السعر لليلة", "العملة", "إجمالي الغرفة", "غسيل", "كافيتيريا", "جولات", "بيك أب", "الإجمالي الكلي", "المدفوع", "المتبقي", "طريقة الدفع", "المصدر", "الحالة"];
    const rows = list.map((b) => { const gt = bookingGrandTotal(b); return [b.code, b.room, b.guestName, b.phone, b.checkin, b.checkout, nightsBetween(b.checkin, b.checkout), b.priceNight, b.currency, b.totalRoom, b.extras?.laundry, b.extras?.cafeteria, b.extras?.tours, b.extras?.pickup, gt, b.amountPaid, gt - (Number(b.amountPaid) || 0), b.paymentMethod, b.source, b.status]; });
    downloadCSV("bookings.csv", headers, rows);
  }

  return (
    <div style={{ padding: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input className="cx-input" style={{ maxWidth: 220 }} placeholder="بحث برقم الغرفة أو الاسم أو الكود" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <input className="cx-input" type="date" title="من تاريخ" style={{ width: 150 }} value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          <input className="cx-input" type="date" title="إلى تاريخ" style={{ width: 150 }} value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          {(dateFrom || dateTo) && <button className="cx-btn cx-btn-outline" onClick={() => { setDateFrom(""); setDateTo(""); }}>مسح الفترة</button>}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="cx-btn cx-btn-outline" onClick={exportCSV}><Download size={13} /> تصدير CSV</button>
          {perms.editBookings && (<label className="cx-btn cx-btn-outline" style={{ cursor: "pointer" }}><Upload size={13} /> استيراد من Booking.com<input type="file" accept=".csv" style={{ display: "none" }} onChange={onFileSelected} /></label>)}
          {(perms.editBookings || perms.canCreateBookings) && <button className="cx-btn cx-btn-gold" onClick={startNew}><Plus size={14} /> حجز جديد</button>}
        </div>
      </div>

      {perms.canApproveBookings && pendingBookings.length > 0 && (
        <div className="cx-card" style={{ padding: 12, marginBottom: 14, borderColor: "#7A5FB5" }}>
          <div style={{ fontWeight: 800, marginBottom: 8, color: "#7A5FB5" }}>حجوزات مباشرة بانتظار الموافقة ({pendingBookings.length})</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {pendingBookings.map((b) => (
              <div key={b.id} style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, borderBottom: "1px solid var(--hair)", paddingBottom: 8 }}>
                <div style={{ fontSize: 12.5 }}><div style={{ fontWeight: 700 }}>غرفة {b.room} · {b.guestName}</div><div style={{ color: "var(--muted)" }}>{b.checkin} → {b.checkout} · {fmt(bookingGrandTotal(b))} {b.currency} · {b.paymentMethod}</div></div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button className="cx-btn cx-btn-outline" onClick={() => startEdit(b)}><Pencil size={13} /> مراجعة</button>
                  <button className="cx-btn cx-btn-gold" onClick={() => approveBooking(b)}><Check size={13} /> موافقة</button>
                  <TwoStepButton label="رفض" confirmLabel="تأكيد الرفض؟" onConfirm={() => rejectBooking(b)} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {needsReviewCount > 0 && <div className="cx-card" style={{ padding: 10, marginBottom: 12, background: "#FBF1DC", fontSize: 12.5, display: "flex", gap: 6, alignItems: "center" }}><AlertTriangle size={14} color="#B8912F" /> فيه {needsReviewCount} حجز محتاج مراجعة الغرفة/الاسم (اتحطت تلقائيًا من الاستيراد)</div>}

      {importPreview && (
        <div className="cx-card" style={{ padding: 14, marginBottom: 14 }}>
          <div style={{ fontWeight: 800, marginBottom: 4 }}>معاينة الاستيراد ({importPreview.length} صف) — راجع الغرفة والاسم قبل التأكيد</div>
          <div style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 8 }}>لو الصف نفس كود حجز موجود أو نفس الغرفة والتواريخ بالظبط، هيتحدّث الحجز الموجود مش هيتكرر. لو الغرفة متعارضة مع حجز تاني مختلف، الصف بيتستبعد تلقائيًا لحد ما تراجعه.</div>
          <div style={{ overflowX: "auto" }}>
            <table className="cx-table" style={{ fontSize: 11.5, minWidth: 760 }}>
              <thead><tr><th className="cx-th">استبعاد</th><th className="cx-th">الكود</th><th className="cx-th">الغرفة</th><th className="cx-th">الاسم</th><th className="cx-th">من - إلى</th><th className="cx-th">السعر</th><th className="cx-th">الإجمالي</th><th className="cx-th">دفع</th><th className="cx-th">نوع العملية</th></tr></thead>
              <tbody>
                {importPreview.map((r, idx) => (
                  <tr key={r.id} style={{ opacity: r.excluded ? 0.5 : 1, background: r.matchType === "conflict" ? "#F4E7E2" : r.matchType === "update" ? "#FBF1DC" : "transparent" }}>
                    <td style={{ textAlign: "center" }}><input type="checkbox" checked={r.excluded} onChange={(e) => updateImportRow(idx, { excluded: e.target.checked })} /></td>
                    <td>{r.code || "—"}</td>
                    <td><select className="cx-select" value={r.room} onChange={(e) => updateImportRow(idx, { room: Number(e.target.value) })}><option value="">اختر</option>{rooms.map((rm) => <option key={rm.number} value={rm.number}>{rm.number}</option>)}</select></td>
                    <td><input className="cx-input" value={r.guestName} onChange={(e) => updateImportRow(idx, { guestName: e.target.value })} /></td>
                    <td style={{ whiteSpace: "nowrap" }}>{r.checkin} → {r.checkout}</td>
                    <td>{r.priceNight} {r.currency}</td>
                    <td>{fmt(bookingGrandTotal(r))}</td>
                    <td>{r.paymentMethod}</td>
                    <td>
                      {r.matchType === "conflict" && <span style={{ color: "var(--rust)", fontWeight: 700 }}><AlertTriangle size={12} style={{ verticalAlign: -2 }} /> تعارض - غيّر الغرفة أو استبعد</span>}
                      {r.matchType === "update" && <span style={{ color: "var(--gold)", fontWeight: 700 }}>تحديث لحجز موجود</span>}
                      {r.matchType === "new" && (r.needsRoomReview ? <span style={{ color: "var(--rust)" }}>حجز جديد - راجع الغرفة</span> : <span style={{ color: "var(--sage)" }}>حجز جديد - تمام</span>)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
            <button className="cx-btn cx-btn-gold" onClick={confirmImport}><Check size={14} /> تأكيد الاستيراد</button>
            <button className="cx-btn cx-btn-outline" onClick={() => setImportPreview(null)}>إلغاء</button>
          </div>
        </div>
      )}

      {form && (
        <div className="cx-card" style={{ padding: 14, marginBottom: 14 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 8 }}>
            <div><label style={{ fontSize: 11, color: "var(--muted)" }}>كود الحجز (اختياري)</label><input className="cx-input" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></div>
            <div><label style={{ fontSize: 11, color: "var(--muted)" }}>الغرفة</label><select className="cx-select" value={form.room} onChange={(e) => onRoomChange(e.target.value)}><option value="">اختر</option>{rooms.map((r) => <option key={r.number} value={r.number}>{r.number} - {r.type}</option>)}</select>
              {form.room && (() => { const r = rooms.find((x) => x.number === Number(form.room)); return r ? <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 2 }}>السعة القصوى: {r.capacity || 2} أفراد · {r.beds}</div> : null; })()}
            </div>
            <div><label style={{ fontSize: 11, color: "var(--muted)" }}>اسم النزيل</label><input className="cx-input" value={form.guestName} onChange={(e) => setForm({ ...form, guestName: e.target.value })} /></div>
            <div><label style={{ fontSize: 11, color: "var(--muted)" }}>الهاتف</label><input className="cx-input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
            <div><label style={{ fontSize: 11, color: "var(--muted)" }}>عدد الأفراد</label><input className="cx-input" type="number" min="1" value={form.pax} onChange={(e) => setForm({ ...form, pax: e.target.value })} /></div>
            <div><label style={{ fontSize: 11, color: "var(--muted)" }}>تاريخ الدخول</label><input className="cx-input" type="date" value={form.checkin} onChange={(e) => setForm({ ...form, checkin: e.target.value })} /></div>
            <div><label style={{ fontSize: 11, color: "var(--muted)" }}>تاريخ الخروج</label><input className="cx-input" type="date" value={form.checkout} onChange={(e) => setForm({ ...form, checkout: e.target.value })} /></div>
            <div><label style={{ fontSize: 11, color: "var(--muted)" }}>السعر لليلة {moneyLocked && <Lock size={10} style={{ verticalAlign: -1 }} />}</label><div style={{ display: "flex", gap: 4 }}><input className="cx-input" type="number" disabled={moneyLocked} value={form.priceNight} onChange={(e) => setForm({ ...form, priceNight: e.target.value })} /><select className="cx-select" disabled={moneyLocked} value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} style={{ width: 80 }}>{CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}</select></div></div>
            <div><label style={{ fontSize: 11, color: "var(--muted)" }}>إجمالي الغرفة ({nights} ليلة) {moneyLocked && <Lock size={10} style={{ verticalAlign: -1 }} />}</label><input className="cx-input" type="number" disabled={moneyLocked} placeholder={String(autoTotalRoom)} value={form.totalRoom} onChange={(e) => setForm({ ...form, totalRoom: e.target.value })} /></div>
            <div><label style={{ fontSize: 11, color: "var(--muted)" }}>طريقة الدفع {moneyLocked && <Lock size={10} style={{ verticalAlign: -1 }} />}</label><select className="cx-select" disabled={moneyLocked} value={form.paymentMethod} onChange={(e) => setForm({ ...form, paymentMethod: e.target.value })}>{PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}</select></div>
            <div><label style={{ fontSize: 11, color: "var(--muted)" }}>جهة الحجز</label><input className="cx-input" list="sources" value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} /><datalist id="sources">{BOOKING_SOURCES.map((s) => <option key={s}>{s}</option>)}</datalist>
              {OTA_SOURCES.includes(form.source) && <div style={{ fontSize: 10, color: "#7A5FB5", marginTop: 2 }}>حجز أونلاين (OTA) - هيتحسب في تقرير "إيراد الحجوزات الأونلاين"</div>}
            </div>
            <div><label style={{ fontSize: 11, color: "var(--muted)" }}>الحالة</label><select className="cx-select" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>{BOOKING_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}</select></div>
          </div>

          {moneyLocked && <div style={{ marginTop: 10, fontSize: 12, color: "var(--muted)", background: "var(--paper2)", borderRadius: 8, padding: 8, display: "flex", gap: 6, alignItems: "center" }}><Lock size={13} /> حجز قديم - أي حاجة فلوس فيه بقت مقفولة ومش قابلة للتعديل. لو محتاج تصحيح مالي كلّم المدير العام.</div>}

          {conflict && (
            <div style={{ marginTop: 10, color: "var(--rust)", fontSize: 12.5, background: "#F4E7E2", borderRadius: 8, padding: 10 }}>
              <div style={{ marginBottom: 6 }}><AlertTriangle size={13} style={{ verticalAlign: -2 }} /> تنبيه: الغرفة دي محجوزة بالفعل في تواريخ متداخلة.</div>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 700 }}><input type="checkbox" checked={!!form.duplicateConfirmed} onChange={(e) => setForm({ ...form, duplicateConfirmed: e.target.checked })} /> تسكين مكرر - الضيف اللي قبله خرج بدري من الغرفة، وده حجز جديد شرعي بتفاصيل جديدة</label>
            </div>
          )}

          <div className="cx-card" style={{ marginTop: 10, padding: 10, background: "var(--paper2)" }}>
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>رسوم إضافية {moneyLocked && <Lock size={10} style={{ verticalAlign: -1 }} />}</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(100px,1fr))", gap: 8 }}>
              <div><label style={{ fontSize: 10.5, color: "var(--muted)" }}>غسيل</label><input className="cx-input" type="number" disabled={moneyLocked} value={form.extras.laundry} onChange={(e) => setForm({ ...form, extras: { ...form.extras, laundry: e.target.value } })} /></div>
              <div><label style={{ fontSize: 10.5, color: "var(--muted)" }}>كافيتيريا</label><input className="cx-input" type="number" disabled={moneyLocked} value={form.extras.cafeteria} onChange={(e) => setForm({ ...form, extras: { ...form.extras, cafeteria: e.target.value } })} /></div>
              <div><label style={{ fontSize: 10.5, color: "var(--muted)" }}>جولات</label><input className="cx-input" type="number" disabled={moneyLocked} value={form.extras.tours} onChange={(e) => setForm({ ...form, extras: { ...form.extras, tours: e.target.value } })} /></div>
              <div><label style={{ fontSize: 10.5, color: "var(--muted)" }}>بيك أب</label><input className="cx-input" type="number" disabled={moneyLocked} value={form.extras.pickup} onChange={(e) => setForm({ ...form, extras: { ...form.extras, pickup: e.target.value } })} /></div>
            </div>
          </div>

          <div className="cx-card" style={{ marginTop: 10, padding: 10, background: "var(--paper2)" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, marginBottom: form.earlyCheckin?.applied ? 8 : 0 }}>
              <input type="checkbox" disabled={moneyLocked} checked={!!form.earlyCheckin?.applied} onChange={(e) => setForm({ ...form, earlyCheckin: { ...form.earlyCheckin, applied: e.target.checked } })} /> دخول مبكر قبل معاد الحجز الأصلي {moneyLocked && <Lock size={10} />}
            </label>
            {form.earlyCheckin?.applied && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 8 }}>
                <div><label style={{ fontSize: 10.5, color: "var(--muted)" }}>رسم الدخول المبكر</label><input className="cx-input" type="number" disabled={moneyLocked} value={form.earlyCheckin.fee} onChange={(e) => setForm({ ...form, earlyCheckin: { ...form.earlyCheckin, fee: e.target.value } })} /></div>
                <div style={{ gridColumn: "span 2" }}><label style={{ fontSize: 10.5, color: "var(--muted)" }}>ملاحظة الدخول المبكر</label><input className="cx-input" disabled={moneyLocked} value={form.earlyCheckin.note} onChange={(e) => setForm({ ...form, earlyCheckin: { ...form.earlyCheckin, note: e.target.value } })} /></div>
              </div>
            )}
          </div>

          {ONLINE_METHODS.includes(form.paymentMethod) && (
            <div className="cx-card" style={{ marginTop: 10, padding: 10, background: "var(--paper2)" }}>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>تفاصيل الدفع الأونلاين {moneyLocked && <Lock size={10} style={{ verticalAlign: -1 }} />}</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 8 }}>
                <input className="cx-input" placeholder="اسم المرسل" disabled={moneyLocked} value={form.paymentDetails.senderName} onChange={(e) => setForm({ ...form, paymentDetails: { ...form.paymentDetails, senderName: e.target.value } })} />
                <input className="cx-input" placeholder={form.paymentMethod === "فيزا" ? "آخر ٤ أرقام الكارت" : "رقم المحفظة / الهاتف"} disabled={moneyLocked} value={form.paymentDetails.senderNumber} onChange={(e) => setForm({ ...form, paymentDetails: { ...form.paymentDetails, senderNumber: e.target.value } })} />
                <input className="cx-input" placeholder="رقم العملية / ملاحظة" disabled={moneyLocked} value={form.paymentDetails.ref} onChange={(e) => setForm({ ...form, paymentDetails: { ...form.paymentDetails, ref: e.target.value } })} />
              </div>
            </div>
          )}

          <div className="cx-card" style={{ marginTop: 10, padding: 10 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 8 }}>
              <div><label style={{ fontSize: 11, color: "var(--muted)" }}>الإجمالي الكلي (غرفة + رسوم)</label><div style={{ fontWeight: 800, fontSize: 15, padding: "6px 0" }}>{fmt(grandTotal)} {form.currency}</div></div>
              <div><label style={{ fontSize: 11, color: "var(--muted)" }}>المدفوع حتى الآن {moneyLocked && <Lock size={10} style={{ verticalAlign: -1 }} />}</label><input className="cx-input" type="number" disabled={moneyLocked} value={form.amountPaid} onChange={(e) => setForm({ ...form, amountPaid: e.target.value })} /></div>
              <div><label style={{ fontSize: 11, color: "var(--muted)" }}>المتبقي على النزيل</label><div style={{ fontWeight: 800, fontSize: 15, padding: "6px 0", color: balanceDue > 0 ? "var(--rust)" : "var(--sage)" }}>{fmt(balanceDue)} {form.currency}</div></div>
              {form.paymentMethod === "كاش" && (<>
                <div><label style={{ fontSize: 11, color: "var(--muted)" }}>المبلغ المُستلم نقدًا</label><input className="cx-input" type="number" disabled={moneyLocked} value={form.amountTendered} onChange={(e) => setForm({ ...form, amountTendered: e.target.value })} /></div>
                <div><label style={{ fontSize: 11, color: "var(--muted)" }}>الباقي (الفكة)</label><div style={{ fontWeight: 800, fontSize: 15, padding: "6px 0" }}>{changeDue != null ? fmt(changeDue) : "—"} {form.currency}</div></div>
              </>)}
            </div>
            <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 6 }}><input type="checkbox" disabled={moneyLocked} checked={form.settled} onChange={(e) => setForm({ ...form, settled: e.target.checked })} /><span style={{ fontSize: 12.5 }}>تم تحصيل كامل المبلغ (مُصفّى)</span></div>
          </div>

          <div style={{ marginTop: 8 }}><label style={{ fontSize: 11, color: "var(--muted)" }}>ملاحظات</label><input className="cx-input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
          <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
            <button className="cx-btn cx-btn-gold" onClick={saveBooking}><Check size={14} /> حفظ الحجز</button>
            <button className="cx-btn cx-btn-outline" onClick={() => setForm(null)}>إلغاء</button>
          </div>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {list.length === 0 && <div style={{ color: "var(--muted)", fontSize: 13, padding: 20, textAlign: "center" }}>لا يوجد حجوزات مطابقة</div>}
        {list.map((b) => { const gt = bookingGrandTotal(b); const due = gt - (Number(b.amountPaid) || 0); return (
          <div key={b.id} className="cx-card" style={{ padding: 12, display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
            <div>
              <div style={{ fontWeight: 800 }}>غرفة {b.room} · {b.guestName} {b.needsRoomReview && <span className="cx-pill" style={{ background: "#FBF1DC", color: "var(--gold)", marginRight: 6 }}>يحتاج مراجعة</span>} {b.approvalStatus === "pending" && <span className="cx-pill" style={{ background: "#EDE8F5", color: "#7A5FB5", marginRight: 6 }}>بانتظار الموافقة</span>}</div>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>{b.checkin} → {b.checkout} · {nightsBetween(b.checkin, b.checkout)} ليلة · {b.pax} أفراد {b.code && `· كود ${b.code}`}</div>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>{b.source} · {b.paymentMethod}{b.paymentDetails?.senderName ? ` (${b.paymentDetails.senderName} · ${b.paymentDetails.senderNumber})` : ""} · الإجمالي {fmt(gt)} {b.currency} {due > 0 && <span style={{ color: "var(--rust)" }}>· متبقي {fmt(due)}</span>}</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span className="cx-pill" style={{ background: "#00000010", color: b.status === "ملغي" ? "var(--rust)" : "var(--teal)" }}>{b.status}</span>
              {perms.editBookings && (<>
                <button className="cx-btn cx-btn-outline" onClick={() => startEdit(b)}><Pencil size={13} /></button>
                {(Number(b.amountPaid) || 0) <= 0 ? (
                  <TwoStepButton label="" confirmLabel="حذف؟" icon={<Trash2 size={13} />} onConfirm={() => removeBooking(b.id)} />
                ) : (
                  <span title="فيه مبلغ متحصّل - استخدم الحالة (ملغي) بدل الحذف" style={{ opacity: 0.4 }}><Trash2 size={13} /></span>
                )}
              </>)}
            </div>
          </div>
        ); })}
      </div>
    </div>
  );
}
