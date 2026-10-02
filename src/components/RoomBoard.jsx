import React, { useState, useEffect, useMemo } from "react";
import { Pencil, Check, X, Eye, AlertTriangle } from "lucide-react";
import { fmt, money, emptyMoney, currencyKeysOf, computeShiftTotals, bookingGrandTotal, COMMON_CURRENCIES, ONLINE_METHODS, PAYMENT_METHODS } from "../domain/money";
import { todayStr, nightsBetween } from "../domain/dates";
import { SHIFTS, STATUS_COLORS, MANUAL_STATUS_OPTIONS, STAFF_ALLOWED_ON_ACTIVE_BOOKING, roomFloor } from "../domain/constants";
import { computeRoomStatus } from "../domain/bookingLogic";
import { getShiftRecord } from "../data/shifts";

const STATUS_TINTS = { available: "#E6F2EA", occupied_paid: "#E3EDED", occupied_unpaid: "#F5E2E2", reserved: "#EDE7F5", early_checkout: "#FBE9DA", maintenance: "#EEEBE7", cleaning: "#E3EBF0" };

export function RoomBoard({ rooms, overrides, bookings, perms, onSaveOverride, onSaveRoom, onToggleSettled, onUpdateBooking, onEditBooking, onLog, showToast, dataVersion }) {
  const [selected, setSelected] = useState(null);
  const [kpis, setKpis] = useState(null);
  const [extrasDraft, setExtrasDraft] = useState(null);
  const [collectMethod, setCollectMethod] = useState("كاش");
  const date = todayStr();
  const room = rooms.find((r) => r.number === selected);
  const status = selected ? computeRoomStatus(selected, bookings, overrides, date) : null;
  const [editType, setEditType] = useState(""); const [editPrice, setEditPrice] = useState(""); const [editCurrency, setEditCurrency] = useState("USD"); const [editCapacity, setEditCapacity] = useState(2); const [editBeds, setEditBeds] = useState(""); const [editMode, setEditMode] = useState(false);

  useEffect(() => { if (room) { setEditType(room.type); setEditPrice(room.price); setEditCurrency(room.currency); setEditCapacity(room.capacity || 2); setEditBeds(room.beds || ""); setEditMode(false); } }, [selected]);
  useEffect(() => { if (status?.booking) setExtrasDraft({ laundry: status.booking.extras?.laundry || "", cafeteria: status.booking.extras?.cafeteria || "", tours: status.booking.extras?.tours || "", pickup: status.booking.extras?.pickup || "" }); else setExtrasDraft(null); }, [selected, status?.booking?.id]);
  useEffect(() => { if (status?.booking) setCollectMethod(status.booking.paymentMethod || "كاش"); }, [selected, status?.booking?.id]);

  useEffect(() => {
    (async () => {
      let rev = emptyMoney(), exp = emptyMoney(), flagged = 0;
      for (const s of SHIFTS) {
        const r = await getShiftRecord(date, s.key);
        if (!r) continue;
        const t = computeShiftTotals(r);
        currencyKeysOf(t.totalCollections).forEach((c) => { rev[c] = (rev[c] || 0) + t.totalCollections[c]; });
        currencyKeysOf(t.totalExpenses).forEach((c) => { exp[c] = (exp[c] || 0) + t.totalExpenses[c]; });
        if (r.flagged) flagged += 1;
      }
      setKpis({ rev, exp, flagged });
    })();
  }, [date, dataVersion]);

  const bookingActiveOnRoom = selected ? bookings.some((b) => b.room === selected && b.status !== "ملغي" && b.checkin <= date && date < b.checkout) : false;
  const statusEditLocked = perms.roomStatusRestricted && bookingActiveOnRoom;

  async function saveOverride(statusKey) {
    const res = await onSaveOverride(selected, statusKey);
    if (res?.error) { showToast(res.error); return; }
    onLog(`تغيير حالة الغرفة ${selected} إلى: ${MANUAL_STATUS_OPTIONS.find((o) => o.key === statusKey)?.label}`);
    showToast("تم تحديث حالة الغرفة");
  }
  async function saveRoomConfig() {
    const res = await onSaveRoom({ number: selected, type: editType, price: Number(editPrice) || 0, currency: editCurrency, capacity: Number(editCapacity) || 1, beds: editBeds });
    if (res?.error) { showToast(res.error); return; }
    onLog(`تعديل بيانات الغرفة ${selected}`); setEditMode(false); showToast("تم حفظ بيانات الغرفة");
  }
  // تسجيل تحصيل كامل المبلغ لازم يسجل طريقة الدفع الفعلية (فيزا/انستاباي/
  // فودافون كاش/تحويل بنكي...) مش بس يعلّم "متحصّل" - عشان التقرير يقدر
  // يحسب كل طريقة دفع صح، فبنحدّث amountPaid وطريقة الدفع مع علامة التحصيل
  // في تحديث واحد بدل ما نسيب طريقة الدفع زي ما كانت وقت إنشاء الحجز.
  async function collectFullPayment(booking) {
    const gt = bookingGrandTotal(booking);
    const res = await onUpdateBooking(booking.id, { ...booking, paymentMethod: collectMethod, amountPaid: gt, settled: true });
    if (res?.error) { showToast(res.error); return; }
    onLog(`تحصيل كامل مبلغ الحجز (${collectMethod}) - غرفة ${booking.room} - ${booking.guestName}`);
    showToast("تم تسجيل التحصيل الكامل");
  }
  async function undoSettled(booking) {
    const res = await onToggleSettled(booking, false);
    if (res?.error) { showToast(res.error); return; }
    onLog(`إلغاء تحصيل كامل مبلغ الحجز - غرفة ${booking.room} - ${booking.guestName}`);
    showToast("تم إلغاء علامة التحصيل");
  }
  async function saveExtras(booking) {
    const res = await onUpdateBooking(booking.id, { ...booking, extras: extrasDraft });
    if (res?.error) { showToast(res.error); return; }
    onLog(`تعديل الرسوم الإضافية - غرفة ${booking.room} - ${booking.guestName}`);
    showToast("تم حفظ الرسوم الإضافية");
  }

  const counts = useMemo(() => { const c = { available: 0, occupied_paid: 0, occupied_unpaid: 0, reserved: 0, maintenance: 0, cleaning: 0, early_checkout: 0 }; rooms.forEach((r) => { const s = computeRoomStatus(r.number, bookings, overrides, date); c[s.key] = (c[s.key] || 0) + 1; }); return c; }, [rooms, bookings, overrides]);
  const revCurrencies = kpis ? currencyKeysOf(kpis.rev, kpis.exp) : [];

  return (
    <div style={{ padding: 14 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10, marginBottom: 14 }}>
        <div className="cx-kpi"><div style={{ fontSize: 11, color: "var(--muted)" }}>تحصيل اليوم</div><div style={{ fontWeight: 800, fontSize: 15 }}>{kpis ? (revCurrencies.length ? revCurrencies.map((c) => `${money(kpis.rev, c)} ${c}`).join(" + ") : "0") : "…"}</div></div>
        <div className="cx-kpi"><div style={{ fontSize: 11, color: "var(--muted)" }}>مصاريف اليوم</div><div style={{ fontWeight: 800, fontSize: 15 }}>{kpis ? (revCurrencies.length ? revCurrencies.map((c) => `${money(kpis.exp, c)} ${c}`).join(" + ") : "0") : "…"}</div></div>
        <div className="cx-kpi"><div style={{ fontSize: 11, color: "var(--muted)" }}>نسبة الإشغال</div><div style={{ fontWeight: 800, fontSize: 20 }}>{Math.round((((counts.occupied_paid || 0) + (counts.occupied_unpaid || 0)) / rooms.length) * 100)}%</div></div>
        <div className="cx-kpi"><div style={{ fontSize: 11, color: "var(--muted)" }}>شيفتات تحتاج متابعة</div><div style={{ fontWeight: 800, fontSize: 20, color: kpis?.flagged ? "var(--rust)" : "var(--text)" }}>{kpis ? kpis.flagged : "…"}</div></div>
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14, fontSize: 12.5 }}>
        <span className="cx-pill" style={{ background: STATUS_TINTS.available, color: STATUS_COLORS.available }}>متاحة {counts.available || 0}</span>
        <span className="cx-pill" style={{ background: STATUS_TINTS.occupied_paid, color: STATUS_COLORS.occupied_paid }}>مشغولة - متحصّلة {counts.occupied_paid || 0}</span>
        <span className="cx-pill" style={{ background: STATUS_TINTS.occupied_unpaid, color: STATUS_COLORS.occupied_unpaid }}>مشغولة - متبقي فلوس {counts.occupied_unpaid || 0}</span>
        <span className="cx-pill" style={{ background: STATUS_TINTS.reserved, color: STATUS_COLORS.reserved }}>قادمة قريبًا {counts.reserved || 0}</span>
        <span className="cx-pill" style={{ background: STATUS_TINTS.early_checkout, color: STATUS_COLORS.early_checkout }}>غادر مبكرًا {counts.early_checkout || 0}</span>
        <span className="cx-pill" style={{ background: STATUS_TINTS.maintenance, color: STATUS_COLORS.maintenance }}>صيانة {counts.maintenance || 0}</span>
        <span className="cx-pill" style={{ background: STATUS_TINTS.cleaning, color: STATUS_COLORS.cleaning }}>تحت التنظيف {counts.cleaning || 0}</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(110px,1fr))", gap: 10 }}>
        {rooms.map((r) => { const s = computeRoomStatus(r.number, bookings, overrides, date); return (
          <div key={r.number} onClick={() => setSelected(r.number)} className={"cx-tile " + (selected === r.number ? "selected" : "")} style={{ borderRightColor: STATUS_COLORS[s.key], borderRightWidth: 5, background: STATUS_TINTS[s.key] || "var(--paper)" }}>
            <div style={{ fontWeight: 800, fontSize: 20 }}>{r.number}</div>
            {s.guest && <div style={{ fontSize: 12, fontWeight: 700, marginTop: 4 }}>{s.guest}</div>}
          </div>
        ); })}
      </div>

      {room && status && (
        <div className="cx-card" style={{ marginTop: 16, padding: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div><div style={{ fontSize: 20, fontWeight: 800 }}>غرفة {room.number}</div><div style={{ fontSize: 13, color: "var(--muted)" }}>{room.type} · {fmt(room.price)} {room.currency}</div></div>
            <button className="cx-btn cx-btn-outline" onClick={() => setSelected(null)}><X size={14} /></button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(110px,1fr))", gap: 8, marginTop: 10, fontSize: 12.5, background: "var(--paper2)", borderRadius: 8, padding: 10 }}>
            <div><div style={{ color: "var(--muted)", fontSize: 10.5 }}>الدور</div><div style={{ fontWeight: 700 }}>الدور {roomFloor(room.number)}</div></div>
            <div><div style={{ color: "var(--muted)", fontSize: 10.5 }}>السعة القصوى</div><div style={{ fontWeight: 700 }}>{room.capacity || 2} أفراد</div></div>
            <div><div style={{ color: "var(--muted)", fontSize: 10.5 }}>الأسرّة</div><div style={{ fontWeight: 700 }}>{room.beds || "—"}</div></div>
          </div>

          {status.booking && (() => { const b = status.booking; const gt = bookingGrandTotal(b); const paid = Number(b.amountPaid) || 0; const due = gt - paid; const extrasList = [
              b.extras?.laundry > 0 && ["غسيل", b.extras.laundry],
              b.extras?.cafeteria > 0 && ["كافيتيريا", b.extras.cafeteria],
              b.extras?.tours > 0 && ["جولات", b.extras.tours],
              b.extras?.pickup > 0 && ["بيك أب", b.extras.pickup],
              b.earlyCheckin?.applied && ["دخول مبكر", b.earlyCheckin.fee || 0],
            ].filter(Boolean); return (
            <div className="cx-card" style={{ marginTop: 10, padding: 12, background: "var(--paper2)" }}>
              <div style={{ fontWeight: 800, marginBottom: 6 }}>بطاقة الحجز الحالي {b.code && <span style={{ fontWeight: 400, color: "var(--muted)", fontSize: 12 }}>· كود {b.code}</span>} {b.paymentDetails?.onlinePaid && <span className="cx-pill" style={{ background: "#EDE8F5", color: "#6B4FA0", marginRight: 6, fontSize: 11 }}>مدفوع أونلاين</span>}</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(120px,1fr))", gap: 8, fontSize: 12.5 }}>
                <div><div style={{ color: "var(--muted)", fontSize: 10.5 }}>النزيل</div><div style={{ fontWeight: 700 }}>{b.guestName}</div></div>
                <div><div style={{ color: "var(--muted)", fontSize: 10.5 }}>عدد الأفراد</div><div style={{ fontWeight: 700 }}>{b.pax || 1}</div></div>
                <div><div style={{ color: "var(--muted)", fontSize: 10.5 }}>مصدر الحجز</div><div style={{ fontWeight: 700 }}>{b.source}</div></div>
                <div><div style={{ color: "var(--muted)", fontSize: 10.5 }}>تشيك إن</div><div style={{ fontWeight: 700 }}>{b.checkin}</div></div>
                <div><div style={{ color: "var(--muted)", fontSize: 10.5 }}>تشيك أوت</div><div style={{ fontWeight: 700 }}>{b.checkout}</div></div>
                <div><div style={{ color: "var(--muted)", fontSize: 10.5 }}>عدد الليالي</div><div style={{ fontWeight: 700 }}>{nightsBetween(b.checkin, b.checkout)}</div></div>
                <div><div style={{ color: "var(--muted)", fontSize: 10.5 }}>سعر الليلة × المدة</div><div style={{ fontWeight: 700 }}>{fmt(b.priceNight)} × {nightsBetween(b.checkin, b.checkout)} = {fmt(b.totalRoom)} {b.currency}</div></div>
                <div><div style={{ color: "var(--muted)", fontSize: 10.5 }}>طريقة الدفع</div><div style={{ fontWeight: 700 }}>{b.paymentMethod}</div></div>
                {(ONLINE_METHODS.includes(b.paymentMethod) || b.paymentDetails?.onlinePaid) && b.paymentDetails?.senderName && (
                  <div style={{ gridColumn: "1 / -1" }}><div style={{ color: "var(--muted)", fontSize: 10.5 }}>تفاصيل الدفع الأونلاين</div><div style={{ fontWeight: 700 }}>{b.paymentDetails.senderName} · {b.paymentDetails.senderNumber} {b.paymentDetails.ref && `· ${b.paymentDetails.ref}`}</div></div>
                )}
                <div><div style={{ color: "var(--muted)", fontSize: 10.5 }}>الإجمالي الكلي</div><div style={{ fontWeight: 700 }}>{fmt(gt)} {b.currency}</div></div>
                {!b.paymentDetails?.onlinePaid && (<>
                  <div><div style={{ color: "var(--muted)", fontSize: 10.5 }}>المدفوع</div><div style={{ fontWeight: 700 }}>{fmt(paid)} {b.currency}</div></div>
                  <div><div style={{ color: "var(--muted)", fontSize: 10.5 }}>المتبقي</div><div style={{ fontWeight: 800, color: due > 0 ? "var(--rust)" : "var(--sage)" }}>{fmt(Math.max(due, 0))} {b.currency}</div></div>
                </>)}
              </div>

              {extrasDraft && (perms.editBookings || perms.markPaymentReceived) ? (
                <div style={{ marginTop: 10, background: "#fff", borderRadius: 8, padding: 10 }}>
                  <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>رسوم إضافية (تقدر تضيفها هنا على طول من غير ما تفتح الحجز كامل)</div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(90px,1fr))", gap: 6 }}>
                    <div><label style={{ fontSize: 10, color: "var(--muted)" }}>غسيل</label><input className="cx-input" type="number" value={extrasDraft.laundry} onChange={(e) => setExtrasDraft({ ...extrasDraft, laundry: e.target.value })} /></div>
                    <div><label style={{ fontSize: 10, color: "var(--muted)" }}>كافيتيريا</label><input className="cx-input" type="number" value={extrasDraft.cafeteria} onChange={(e) => setExtrasDraft({ ...extrasDraft, cafeteria: e.target.value })} /></div>
                    <div><label style={{ fontSize: 10, color: "var(--muted)" }}>جولات</label><input className="cx-input" type="number" value={extrasDraft.tours} onChange={(e) => setExtrasDraft({ ...extrasDraft, tours: e.target.value })} /></div>
                    <div><label style={{ fontSize: 10, color: "var(--muted)" }}>بيك أب</label><input className="cx-input" type="number" value={extrasDraft.pickup} onChange={(e) => setExtrasDraft({ ...extrasDraft, pickup: e.target.value })} /></div>
                  </div>
                  <button className="cx-btn cx-btn-gold" style={{ marginTop: 8, fontSize: 12 }} onClick={() => saveExtras(b)}><Check size={13} /> حفظ الرسوم</button>
                </div>
              ) : extrasList.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontSize: 10.5, color: "var(--muted)", marginBottom: 4 }}>خدمات إضافية أُخذت</div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{extrasList.map(([label, amt]) => <span key={label} className="cx-pill" style={{ background: "#fff" }}>{label}: {fmt(amt)}</span>)}</div>
                </div>
              )}
              {b.earlyCheckin?.applied && b.earlyCheckin.note && <div style={{ marginTop: 6, fontSize: 11.5, color: "var(--muted)" }}>ملاحظة الدخول المبكر: {b.earlyCheckin.note}</div>}
              <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                {perms.markPaymentReceived && !b.paymentDetails?.onlinePaid && (
                  status.paid ? (
                    <button className="cx-btn cx-btn-outline" style={{ fontSize: 12 }} onClick={() => undoSettled(b)}>إلغاء علامة "متحصّل بالكامل"</button>
                  ) : (<>
                    <select className="cx-select" style={{ fontSize: 12, width: 120 }} value={collectMethod} onChange={(e) => setCollectMethod(e.target.value)}>{PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}</select>
                    <button className="cx-btn cx-btn-gold" style={{ fontSize: 12 }} onClick={() => collectFullPayment(b)}><Check size={13} /> تسجيل تحصيل كامل المبلغ</button>
                  </>)
                )}
                {perms.editBookings && onEditBooking && <button className="cx-btn cx-btn-outline" style={{ fontSize: 12 }} onClick={() => onEditBooking(b.id)}><Pencil size={13} /> تعديل تفاصيل الحجز</button>}
              </div>
            </div>
          ); })()}

          {perms.editRoomStatus ? (
            statusEditLocked ? (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 12, color: "var(--rust)", background: "#F4E7E2", borderRadius: 8, padding: 10, marginBottom: 8 }}><AlertTriangle size={13} style={{ verticalAlign: -2 }} /> الغرفة عليها حجز نشط - تغيير حالتها بشكل عام يتم من مدير الحجوزات فقط، عشان نتجنب أي دبل بوكينج.</div>
                <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 6 }}>لو النزيل غادر قبل معاده</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {MANUAL_STATUS_OPTIONS.filter((o) => STAFF_ALLOWED_ON_ACTIVE_BOOKING.includes(o.key)).map((o) => <button key={o.key} className="cx-btn cx-btn-outline" style={{ fontSize: 12 }} onClick={() => saveOverride(o.key)}>{o.label}</button>)}
                </div>
              </div>
            ) : (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 6 }}>تغيير الحالة يدويًا</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{MANUAL_STATUS_OPTIONS.map((o) => <button key={o.key} className="cx-btn cx-btn-outline" style={{ fontSize: 12 }} onClick={() => saveOverride(o.key)}>{o.label}</button>)}</div>
              </div>
            )
          ) : (<div style={{ marginTop: 12, fontSize: 12, color: "var(--muted)", display: "flex", alignItems: "center", gap: 4 }}><Eye size={13} /> عرض فقط لدورك الحالي</div>)}

          {perms.editRoomConfig && (
            <div style={{ marginTop: 14, borderTop: "1px solid var(--hair)", paddingTop: 12 }}>
              {!editMode ? <button className="cx-btn cx-btn-outline" onClick={() => setEditMode(true)}><Pencil size={14} /> تعديل بيانات الغرفة</button> : (
                <div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(120px,1fr))", gap: 8, marginBottom: 8 }}>
                    <input className="cx-input" value={editType} onChange={(e) => setEditType(e.target.value)} placeholder="نوع الغرفة" />
                    <input className="cx-input" type="number" value={editPrice} onChange={(e) => setEditPrice(e.target.value)} placeholder="السعر" />
                    <input className="cx-input" list="room-currencies" value={editCurrency} onChange={(e) => setEditCurrency(e.target.value.toUpperCase())} placeholder="العملة" />
                    <datalist id="room-currencies">{COMMON_CURRENCIES.map((c) => <option key={c} value={c} />)}</datalist>
                    <input className="cx-input" type="number" min="1" value={editCapacity} onChange={(e) => setEditCapacity(e.target.value)} placeholder="السعة القصوى" />
                    <input className="cx-input" value={editBeds} onChange={(e) => setEditBeds(e.target.value)} placeholder="الأسرّة" />
                  </div>
                  <button className="cx-btn cx-btn-gold" onClick={saveRoomConfig}><Check size={14} /> حفظ</button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
