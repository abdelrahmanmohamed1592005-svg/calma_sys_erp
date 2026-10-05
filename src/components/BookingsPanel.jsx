import React, { useState, useEffect } from "react";
import { Pencil, Trash2, AlertTriangle, Check, Plus, Printer, Lock } from "lucide-react";
import { TwoStepButton, PaymentDetailsInline, Logo } from "./shared";
import { fmt, COMMON_CURRENCIES, PAYMENT_METHODS, methodOptionsFor, ONLINE_METHODS, emptyPaymentDetails, bookingGrandTotal, onlineNetAmount } from "../domain/money";
import { todayStr, addDays, nightsBetween, uid, arabicDateLong } from "../domain/dates";
import { sourceOptionsFor, BOOKING_STATUSES, HOTEL_NAME, roomLabel } from "../domain/constants";
import { roomsOverlap, findOverlappingBooking, resolveDuplicateCheckin } from "../domain/bookingLogic";
import { useShiftGate } from "../hooks/useShiftGate";
import { appendBookingCollection } from "../data/shifts";

function emptyBooking() {
  return { id: uid(), code: "", room: "", guestName: "", phone: "", pax: 1, checkin: todayStr(), checkout: addDays(todayStr(), 1), priceNight: "", currency: "USD", totalRoom: "", extras: { laundry: "", cafeteria: "", tours: "", pickup: "" }, earlyCheckin: { applied: false, fee: "", note: "" }, paymentMethod: "كاش", paymentDetails: emptyPaymentDetails(), amountPaid: "", amountTendered: "", source: "مباشر", status: "مؤكد", approvalStatus: "approved", settled: false, notes: "", imported: false, needsRoomReview: false, duplicateConfirmed: false };
}

export function BookingsPanel({ rooms, bookings, perms, role, profile, onInsertBooking, onUpdateBooking, onDeleteBooking, onLog, showToast, pendingEditId, onConsumeEditRequest, dataVersion }) {
  const [form, setForm] = useState(null);
  const [filter, setFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  // نفس هوك شيفت موظف الشيفت المستخدم في RoomBoard.jsx بالظبط - عشان لو
  // شيفته مش حاجزه دلوقتي أو شيفته مقفول، ميعرفش يضيف أو يعدّل أي حجز من هنا
  // برده (مش بس من بلوك الغرف)، ومن غير أي تضارب بين الشاشتين.
  const { offShift, shiftClosed, myActiveShiftKey } = useShiftGate(profile, perms, dataVersion);

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
  const moneyLocked = role === "reservations" && isExistingBooking;
  // مدير الحجوزات يضيف حجز ويحدد سعره عادي (فوق)، لكن "استلمنا الفلوس فعليًا
  // ولا لأ" (المدفوع/المتحصّل/الباقي) مش شغله خالص - ده قرار موظف الشيفت
  // اللي قدام النزيل فعليًا. القفل ده شامل حتى وقت إنشاء حجز جديد، مش بس
  // وقت تعديل حجز قديم زي moneyLocked فوق.
  const collectionLocked = role === "reservations";
  // الحجز ده "متحصّل بالكامل" فعلًا ولسه كذلك (form.settled لسه true) - يبقى
  // أي حاجة تخص قيمته (سعر/إجمالي/رسوم/دخول مبكر/طريقة الدفع) مقفولة لحد ما
  // حد يلغي علامة التحصيل الأول، بغض النظر عن الدور. ده هو نفس القرار اللي
  // في بلوك الغرف (RoomBoard.jsx) ونفس قيد قاعدة البيانات (قسم ١٧ في
  // schema.sql) - عشان "خلاص اتحصّل" يفضل معناها خلاص فعليًا.
  const settledLocked = isExistingBooking && !!originalBooking?.settled && !!form?.settled;
  const chargeLocked = moneyLocked || settledLocked;

  // الغرفة بقت بس رقم - مفيش سعر ثابت أو نوع متسجل عليها نرجع نعبّي بيه
  // السعر/العملة تلقائيًا؛ الموظف بيكتب سعر الليلة والعملة بنفسه كل مرة حسب
  // الاتفاق مع النزيل.
  function onRoomChange(roomNum) { setForm((f) => ({ ...f, room: Number(roomNum) })); }

  const nights = form ? nightsBetween(form.checkin, form.checkout) : 0;
  const autoTotalRoom = form ? (Number(form.priceNight) || 0) * nights : 0;
  const earlyFee = form && form.earlyCheckin?.applied ? Number(form.earlyCheckin.fee) || 0 : 0;
  const grandTotal = form ? (Number(form.totalRoom || autoTotalRoom) || 0) + (Number(form.extras.laundry) || 0) + (Number(form.extras.cafeteria) || 0) + (Number(form.extras.tours) || 0) + (Number(form.extras.pickup) || 0) + earlyFee : 0;
  const balanceDue = form ? grandTotal - (Number(form.amountPaid) || 0) : 0;
  const changeDue = form && form.paymentMethod === "كاش" && form.amountTendered !== "" ? (Number(form.amountTendered) || 0) - grandTotal : null;
  const conflict = form && form.room && roomsOverlap(bookings, Number(form.room), form.checkin, form.checkout, form.id);

  async function saveBooking() {
    if (perms.roomStatusRestricted && offShift) { showToast(shiftClosed ? "شيفتك مقفول - لازم المدير العام أو مدير الحجوزات يفتحوه تاني عشان تقدر تضيف أو تعدّل حجز" : "مش شيفتك دلوقتي - الحجوزات بتتضاف/تتعدل وقت شيفتك اللي حاجزه بس"); return; }
    if (!form.room || !form.guestName.trim()) { showToast("لازم تحدد الغرفة واسم النزيل"); return; }
    // تاريخ الخروج لازم يكون بعد تاريخ الدخول - من غير الفحص ده هنوصل لقيد
    // قاعدة البيانات (bookings_dates_valid) وتظهر رسالة تقنية مش مفهومة.
    if (!form.checkin || !form.checkout || form.checkout <= form.checkin) { showToast("تاريخ الخروج لازم يكون بعد تاريخ الدخول"); return; }
    if (conflict && !form.duplicateConfirmed) { showToast('الغرفة متعارضة مع حجز موجود - لو ده تسكين مكرر شرعي فعّل تأكيد "تسكين مكرر" تحت'); return; }
    // منع أي قيمة سالبة في الرسوم الإضافية/رسم الدخول المبكر من غير داعي
    // تضرب قيد قاعدة البيانات وتطلّع رسالة خطأ تقنية مش مفهومة.
    const clampedExtras = { laundry: Math.max(0, Number(form.extras.laundry) || 0), cafeteria: Math.max(0, Number(form.extras.cafeteria) || 0), tours: Math.max(0, Number(form.extras.tours) || 0), pickup: Math.max(0, Number(form.extras.pickup) || 0) };
    const clampedEarlyCheckin = { ...form.earlyCheckin, fee: Math.max(0, Number(form.earlyCheckin?.fee) || 0) };
    let cleaned = { ...form, room: Number(form.room), totalRoom: form.totalRoom !== "" ? Number(form.totalRoom) : autoTotalRoom, extras: clampedExtras, earlyCheckin: clampedEarlyCheckin, needsRoomReview: false, approvalStatus: "approved" };
    // قفل قيمة الحجز (سعر/إجمالي/رسوم/دخول مبكر/طريقة دفع): لو مدير حجوزات
    // بيعدّل حجز قديم، أو لو الحجز متحصّل بالكامل فعلاً ولسه كذلك - نفرض
    // القيم الأصلية حتى لو الواجهة اتلعب فيها بأي طريقة (دفاع إضافي، القفل
    // الحقيقي في قاعدة البيانات نفسها - قسم ١٤/١٧ في schema.sql).
    if (chargeLocked && originalBooking) {
      cleaned = { ...cleaned, priceNight: originalBooking.priceNight, currency: originalBooking.currency, totalRoom: originalBooking.totalRoom, extras: originalBooking.extras, earlyCheckin: originalBooking.earlyCheckin, paymentMethod: originalBooking.paymentMethod, paymentDetails: originalBooking.paymentDetails };
    }
    // قفل التحصيل (المدفوع/المتحصّل نقدًا/تم التحصيل بالكامل): مدير الحجوزات
    // بس ملوش دعوة بالتحصيل خالص - حجز جديد أو حجز مش مقفول بالكامل بيترجع
    // لقيمته الأصلية (أو صفر لحجز جديد) حتى لو الواجهة اتلعب فيها.
    if (moneyLocked && originalBooking) {
      cleaned = { ...cleaned, amountPaid: originalBooking.amountPaid, amountTendered: originalBooking.amountTendered, settled: originalBooking.settled };
    } else if (collectionLocked) {
      cleaned = { ...cleaned, amountPaid: originalBooking ? originalBooking.amountPaid : 0, amountTendered: originalBooking ? originalBooking.amountTendered : 0, settled: originalBooking ? originalBooking.settled : false };
    }
    // مينفعش "متحصّل بالكامل" يتسجل والمدفوع لسه أقل من الإجمالي الكلي - دفاع
    // إضافي هنا (الشرط الحقيقي في قاعدة البيانات - قسم ٢٤ في schema.sql)،
    // عشان مايحصلش حجز متحصّل بالكامل وعليه متبقي في نفس الوقت.
    if (!cleaned.paymentDetails?.onlinePaid && cleaned.settled) {
      const gtNow = bookingGrandTotal(cleaned);
      if ((Number(cleaned.amountPaid) || 0) < gtNow) { showToast(`مينفعش تعلّمي "متحصّل بالكامل" وفيه ${fmt(gtNow - (Number(cleaned.amountPaid) || 0))} ${cleaned.currency} لسه متبقية`); return; }
    }
    // "تسكين مكرر": الضيف القديم خرج بدري عشان يفسح للحجز الجديد ده. قبل ما
    // نحفظ الحجز الجديد، نتعامل مع الحجز القديم المتعارض:
    // - لو الحجز القديم بدأ قبل الجديد فعلاً: نقصّر تاريخ خروجه لحد تاريخ
    //   دخول الجديد (تاريخ مغادرته الفعلي بالضبط) ونعلّمه "مشي بدري" - مش
    //   "ملغي"، عشان إيراد الليالي اللي قعدها فعلاً يفضل محسوب صحيح.
    // - لو الحجز القديم لسه لم يبدأ أصلًا (بيبدأ في نفس يوم الجديد أو
    //   بعده)، ده مش "تسكين مكرر" حقيقي - ده حجز محتاج إلغاء فعلي، وده قرار
    //   مدير الحجوزات بنفسه يدويًا (زرار الإلغاء)، مش تلقائي من هنا.
    if (conflict && form.duplicateConfirmed) {
      const clash = findOverlappingBooking(bookings, cleaned.room, cleaned.checkin, cleaned.checkout, cleaned.id);
      const resolution = resolveDuplicateCheckin(clash, cleaned.checkin);
      if (resolution?.action === "needs_manual_cancel") {
        showToast("الحجز القديم المتعارض لسه لم يبدأ أصلًا - ده يحتاج إلغاء حقيقي من مدير الحجوزات يدويًا (مش تسكين مكرر تلقائي)، لازم يتم إلغاؤه الأول من شاشة الحجوزات");
        return;
      }
      if (resolution?.action === "trim") {
        const trimRes = await onUpdateBooking(clash.id, { ...clash, checkout: resolution.checkout, status: "تم تسجيل الخروج", leftEarly: true, notes: (clash.notes ? clash.notes + " — " : "") + `مشي بدري في ${resolution.checkout} - الغرفة اتسلمت لحجز تسكين مكرر جديد` });
        if (trimRes?.error) { showToast("تعذر تقصير الحجز القديم: " + trimRes.error); return; }
      }
      cleaned = { ...cleaned, duplicatePlacement: true };
    }
    const res = isExistingBooking ? await onUpdateBooking(cleaned.id, cleaned) : await onInsertBooking(cleaned);
    if (res?.error) { showToast(res.error); return; }
    onLog(`${isExistingBooking ? "تعديل" : "إضافة"} حجز ${roomLabel(rooms, cleaned.room)} — ${cleaned.guestName}${conflict ? " (تسكين مكرر معتمد يدويًا)" : ""}`);
    // لو اتحصّل مبلغ مقدّم وقت إضافة حجز جديد (نزيل مباشر دافع عند موظف
    // الشيفت) سجّله تلقائيًا في يومية شيفته النهارده - عشان رصيد الخزينة/
    // التحصيل حسب طريقة الدفع يعكس الحقيقة من غير ما يحتاج يكتبه تاني يدويًا
    // في اليومية (انظر appendBookingCollection في data/shifts.js). ده صفر
    // دايمًا لو مدير الحجوزات هو اللي عدّل/أضاف (collectionLocked بيصفّر
    // amountPaid له فوق في الحالتين).
    const savedId = res.data?.id || cleaned.id;
    const paidDelta = (Number(cleaned.amountPaid) || 0) - (originalBooking ? Number(originalBooking.amountPaid) || 0 : 0);
    let ledgerWarning = "";
    if (paidDelta !== 0 && myActiveShiftKey) {
      const ledgerRes = await appendBookingCollection(todayStr(), myActiveShiftKey, profile, rooms, {
        id: uid(), bookingId: savedId, room: cleaned.room, guestName: cleaned.guestName,
        amount: paidDelta, currency: cleaned.currency, method: cleaned.paymentMethod,
        note: "تحصيل حجز جديد", at: Date.now(),
      });
      if (ledgerRes?.error) ledgerWarning = " — لكن تعذر تسجيله تلقائيًا في اليومية، سجّليه يدويًا: " + ledgerRes.error;
    }
    setForm(null); showToast(ledgerWarning ? "تم الحفظ" + ledgerWarning : "تم الحفظ");
  }
  async function removeBooking(id) { const b = bookings.find((x) => x.id === id); const res = await onDeleteBooking(id); if (res?.error) { showToast(res.error); return; } onLog(`حذف حجز ${roomLabel(rooms, b?.room)} — ${b?.guestName}`); showToast("تم الحذف"); }

  // رد فلوس حجز ملغي: لما مدير الحجوزات يلغي حجز كان عليه مبلغ متحصّل،
  // refundPending بيتحدد تلقائيًا في قاعدة البيانات (قسم ٢١ في schema.sql).
  // موظف الشيفت بس (markPaymentReceived) هو اللي يسجّل إن الفلوس فعليًا
  // ارتدت للنزيل - بيصفّر المدفوع على الحجز وبيسجّل رد سالب في يوميته
  // النهارده (عشان رصيد الخزينة يقل بقيمة الفلوس اللي خرجت فعليًا من الدرج).
  async function processRefund(b) {
    if (perms.roomStatusRestricted && offShift) { showToast(shiftClosed ? "شيفتك مقفول - لازم يُفتح تاني الأول" : "مش شيفتك دلوقتي"); return; }
    // ملحوظة: amountTendered مش بتتلمس هنا عمدًا - قاعدة البيانات بتمنع
        // موظف الشيفت من تعديلها أصلًا (قسم ١٥ في schema.sql)، وهي كمان مش
        // ليها معنى واضح تترجع له بعد رد الفلوس (كانت بتمثل "اتدفع نقدًا
        // قد إيه وقت التحصيل الأصلي" بس).
    const amount = Number(b.amountPaid) || 0;
    const res = await onUpdateBooking(b.id, { ...b, amountPaid: 0, settled: false, refundPending: false, refundedAmount: amount, refundedBy: profile.username, refundedAt: Date.now() });
    if (res?.error) { showToast(res.error); return; }
    onLog(`رد فلوس حجز ملغي - ${roomLabel(rooms, b.room)} - ${b.guestName} - ${fmt(amount)} ${b.currency} (${b.paymentMethod})`);
    let ledgerWarning = "";
    if (myActiveShiftKey) {
      const ledgerRes = await appendBookingCollection(todayStr(), myActiveShiftKey, profile, rooms, {
        id: uid(), bookingId: b.id, room: b.room, guestName: b.guestName,
        amount: -amount, currency: b.currency, method: b.paymentMethod,
        note: "رد فلوس حجز ملغي", at: Date.now(),
      });
      if (ledgerRes?.error) ledgerWarning = " — لكن تعذر تسجيله تلقائيًا في اليومية، سجّليه يدويًا كمصروف: " + ledgerRes.error;
    } else {
      ledgerWarning = " — سجّلي المبلغ ده يدويًا كمصروف في اليومية عشان رصيد الخزينة يفضل صحيح";
    }
    showToast("تم تسجيل رد الفلوس" + ledgerWarning);
  }

  const list = bookings.filter((b) => {
    if (filter && !String(b.room).includes(filter) && !b.guestName.includes(filter) && !(b.code && b.code.includes(filter))) return false;
    if (dateFrom && b.checkout <= dateFrom) return false;
    if (dateTo && b.checkin > dateTo) return false;
    return true;
  }).sort((a, b) => b.checkin.localeCompare(a.checkin));

  return (
    <div style={{ padding: 14 }}>
      <div className="cx-no-print" style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input className="cx-input" style={{ maxWidth: 220 }} placeholder="بحث برقم الغرفة أو الاسم أو الكود" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <input className="cx-input" type="date" title="من تاريخ" style={{ width: 150 }} value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          <input className="cx-input" type="date" title="إلى تاريخ" style={{ width: 150 }} value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          {(dateFrom || dateTo) && <button className="cx-btn cx-btn-outline" onClick={() => { setDateFrom(""); setDateTo(""); }}>مسح الفترة</button>}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="cx-btn cx-btn-outline" onClick={() => window.print()}><Printer size={13} /> طباعة القائمة</button>
          {(perms.editBookings || perms.canCreateBookings) && (perms.roomStatusRestricted ? !offShift : true) && <button className="cx-btn cx-btn-gold" onClick={startNew}><Plus size={14} /> حجز جديد</button>}
        </div>
      </div>

      {perms.roomStatusRestricted && offShift && (
        <div className="cx-no-print" style={{ marginBottom: 12, fontSize: 12, color: "var(--rust)", background: "#F4E7E2", borderRadius: 8, padding: 10, display: "flex", alignItems: "center", gap: 6 }}>
          <AlertTriangle size={13} /> {shiftClosed ? "شيفتك مقفول - لازم المدير العام أو مدير الحجوزات يفتحوه تاني عشان تقدر تضيف أو تعدّل حجز." : "مش شيفتك دلوقتي - الحجوزات بتتضاف/تتعدل وقت شيفتك اللي حاجزه بس."}
        </div>
      )}

      {/* ترويسة الطباعة - بنفس شكل باقي تقارير السيستم بالظبط */}
      <div className="cx-print-only cx-print-header">
        <div className="cx-print-head-row">
          <div className="cx-print-brand">
            <Logo size={30} />
            {HOTEL_NAME && <div className="cx-print-hotel-name">{HOTEL_NAME}</div>}
          </div>
          <div className="cx-print-meta">
            <div className="cx-print-title">قائمة الحجوزات</div>
            <div>{dateFrom || dateTo ? `${dateFrom || "—"} → ${dateTo || "—"}` : "كل الحجوزات"}{filter ? ` · بحث: ${filter}` : ""}</div>
            <div>تاريخ الإصدار: {arabicDateLong(todayStr())}{profile?.name ? ` · أُعِد بواسطة: ${profile.name}` : ""}</div>
          </div>
        </div>
        <div className="cx-print-rule" />
      </div>

      {form && (
        <div className="cx-card cx-no-print" style={{ padding: 14, marginBottom: 14 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 8 }}>
            <div><label style={{ fontSize: 11, color: "var(--muted)" }}>كود الحجز (اختياري)</label><input className="cx-input" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></div>
            <div><label style={{ fontSize: 11, color: "var(--muted)" }}>الغرفة</label><select className="cx-select" value={form.room} onChange={(e) => onRoomChange(e.target.value)}><option value="">اختر</option>{rooms.map((r) => <option key={r.number} value={r.number}>{r.name || `غرفة ${r.number}`}</option>)}</select></div>
            <div><label style={{ fontSize: 11, color: "var(--muted)" }}>اسم النزيل</label><input className="cx-input" value={form.guestName} onChange={(e) => setForm({ ...form, guestName: e.target.value })} /></div>
            <div><label style={{ fontSize: 11, color: "var(--muted)" }}>الهاتف</label><input className="cx-input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
            <div><label style={{ fontSize: 11, color: "var(--muted)" }}>عدد الأفراد</label><input className="cx-input" type="number" min="1" value={form.pax} onChange={(e) => setForm({ ...form, pax: e.target.value })} /></div>
            <div><label style={{ fontSize: 11, color: "var(--muted)" }}>تاريخ الدخول</label><input className="cx-input" type="date" value={form.checkin} onChange={(e) => { const newCheckin = e.target.value; setForm((f) => ({ ...f, checkin: newCheckin, checkout: f.checkout && f.checkout > newCheckin ? f.checkout : addDays(newCheckin, 1) })); }} /></div>
            <div><label style={{ fontSize: 11, color: "var(--muted)" }}>تاريخ الخروج</label><input className="cx-input" type="date" min={form.checkin ? addDays(form.checkin, 1) : undefined} value={form.checkout} onChange={(e) => setForm({ ...form, checkout: e.target.value })} /></div>
            <div><label style={{ fontSize: 11, color: "var(--muted)" }}>السعر لليلة {chargeLocked && <Lock size={10} style={{ verticalAlign: -1 }} />}</label><div style={{ display: "flex", gap: 4 }}><input className="cx-input" type="number" disabled={chargeLocked} value={form.priceNight} onChange={(e) => setForm({ ...form, priceNight: e.target.value })} /><select className="cx-select" disabled={chargeLocked} value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} style={{ width: 90 }}>{COMMON_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}</select></div></div>
            <div><label style={{ fontSize: 11, color: "var(--muted)" }}>إجمالي الغرفة ({nights} ليلة) {chargeLocked && <Lock size={10} style={{ verticalAlign: -1 }} />}</label><input className="cx-input" type="number" disabled={chargeLocked} placeholder={String(autoTotalRoom)} value={form.totalRoom} onChange={(e) => setForm({ ...form, totalRoom: e.target.value })} /></div>
            <div><label style={{ fontSize: 11, color: "var(--muted)" }}>طريقة الدفع {chargeLocked && <Lock size={10} style={{ verticalAlign: -1 }} />}</label><select className="cx-select" disabled={chargeLocked} value={form.paymentMethod} onChange={(e) => setForm({ ...form, paymentMethod: e.target.value })}>{methodOptionsFor(form.paymentMethod).map((m) => <option key={m} value={m}>{m}</option>)}</select></div>
            <div><label style={{ fontSize: 11, color: "var(--muted)" }}>جهة الحجز</label><select className="cx-select" value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })}>{sourceOptionsFor(form.source).map((s) => <option key={s} value={s}>{s}</option>)}</select></div>
            {/* الحالة (ومعاها "ملغي") من صلاحية مدير الحجوزات بس - موظف
                الشيفت وقت إضافة حجز جديد (walk-in) مش بيشوف الاختيار ده
                خالص، فيفضل الحجز "مؤكد" بالقيمة الافتراضية. ده غير القفل
                الحقيقي في قاعدة البيانات نفسها (قسم ٢٣ في schema.sql) اللي
                بيمنع موظف الشيفت من كتابة "ملغي" حتى لو حد حاول يتخطى
                الواجهة. */}
            {perms.editBookings && <div><label style={{ fontSize: 11, color: "var(--muted)" }}>الحالة</label><select className="cx-select" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>{BOOKING_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}</select></div>}
          </div>

          {moneyLocked && <div style={{ marginTop: 10, fontSize: 12, color: "var(--muted)", background: "var(--paper2)", borderRadius: 8, padding: 8, display: "flex", gap: 6, alignItems: "center" }}><Lock size={13} /> حجز قديم - أي حاجة فلوس فيه بقت مقفولة ومش قابلة للتعديل. لو محتاج تصحيح مالي كلّم المدير العام.</div>}
          {!moneyLocked && settledLocked && <div style={{ marginTop: 10, fontSize: 12, color: "var(--muted)", background: "var(--paper2)", borderRadius: 8, padding: 8, display: "flex", gap: 6, alignItems: "center" }}><Lock size={13} /> الحجز ده متحصّل بالكامل - السعر/الإجمالي/الرسوم مقفولة. لو احتجتي تعدّليها، لازم تلغي علامة "تم تحصيل كامل المبلغ" تحت الأول.</div>}

          {conflict && (
            <div style={{ marginTop: 10, color: "var(--rust)", fontSize: 12.5, background: "#F4E7E2", borderRadius: 8, padding: 10 }}>
              <div style={{ marginBottom: 6 }}><AlertTriangle size={13} style={{ verticalAlign: -2 }} /> تنبيه: الغرفة دي محجوزة بالفعل في تواريخ متداخلة.</div>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 700 }}><input type="checkbox" checked={!!form.duplicateConfirmed} onChange={(e) => setForm({ ...form, duplicateConfirmed: e.target.checked })} /> تسكين مكرر - الضيف اللي قبله خرج بدري من الغرفة، وده حجز جديد شرعي بتفاصيل جديدة</label>
            </div>
          )}

          <div className="cx-card" style={{ marginTop: 10, padding: 10, background: "var(--paper2)" }}>
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>رسوم إضافية {chargeLocked && <Lock size={10} style={{ verticalAlign: -1 }} />}</div>
            {/* شيلنا "غسيل" و"كافيتيريا" من هنا - مبقوش يُضافوا كرسوم على
                الحجز من شاشة الحجوزات. لو حجز قديم كان عليه قيمة فيهم
                فعلاً، القيمة تفضل محفوظة ومحسوبة في الإجمالي زي ما هي -
                بس مفيش إضافة جديدة منها عن طريق الواجهة. */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(100px,1fr))", gap: 8 }}>
              <div><label style={{ fontSize: 10.5, color: "var(--muted)" }}>جولات</label><input className="cx-input" type="number" min="0" disabled={chargeLocked} value={form.extras.tours} onChange={(e) => setForm({ ...form, extras: { ...form.extras, tours: e.target.value } })} /></div>
              <div><label style={{ fontSize: 10.5, color: "var(--muted)" }}>بيك أب</label><input className="cx-input" type="number" min="0" disabled={chargeLocked} value={form.extras.pickup} onChange={(e) => setForm({ ...form, extras: { ...form.extras, pickup: e.target.value } })} /></div>
            </div>
          </div>

          <div className="cx-card" style={{ marginTop: 10, padding: 10, background: "var(--paper2)" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, marginBottom: form.earlyCheckin?.applied ? 8 : 0 }}>
              <input type="checkbox" disabled={chargeLocked} checked={!!form.earlyCheckin?.applied} onChange={(e) => setForm({ ...form, earlyCheckin: { ...form.earlyCheckin, applied: e.target.checked } })} /> دخول مبكر قبل معاد الحجز الأصلي {chargeLocked && <Lock size={10} />}
            </label>
            {form.earlyCheckin?.applied && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 8 }}>
                <div><label style={{ fontSize: 10.5, color: "var(--muted)" }}>رسم الدخول المبكر</label><input className="cx-input" type="number" min="0" disabled={chargeLocked} value={form.earlyCheckin.fee} onChange={(e) => setForm({ ...form, earlyCheckin: { ...form.earlyCheckin, fee: e.target.value } })} /></div>
                <div style={{ gridColumn: "span 2" }}><label style={{ fontSize: 10.5, color: "var(--muted)" }}>ملاحظة الدخول المبكر</label><input className="cx-input" disabled={chargeLocked} value={form.earlyCheckin.note} onChange={(e) => setForm({ ...form, earlyCheckin: { ...form.earlyCheckin, note: e.target.value } })} /></div>
              </div>
            )}
          </div>

          <div className="cx-card" style={{ marginTop: 10, padding: 10, background: "var(--paper2)" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700 }}>
              <input type="checkbox" disabled={chargeLocked} checked={!!form.paymentDetails.onlinePaid} onChange={(e) => setForm({ ...form, paymentDetails: { ...form.paymentDetails, onlinePaid: e.target.checked } })} /> الحجز مدفوع أونلاين (Booking.com أو أي منصة حجز) {chargeLocked && <Lock size={10} style={{ verticalAlign: -1 }} />}
            </label>
            {form.paymentDetails.onlinePaid && (
              <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 8 }}>
                <div><label style={{ fontSize: 10.5, color: "var(--muted)" }}>نسبة عمولة المنصة %</label><input className="cx-input" type="number" disabled={chargeLocked} value={form.paymentDetails.commissionPct} onChange={(e) => setForm({ ...form, paymentDetails: { ...form.paymentDetails, commissionPct: e.target.value } })} /></div>
                <div><label style={{ fontSize: 10.5, color: "var(--muted)" }}>السعر من غير عمولة</label><div style={{ fontWeight: 700, padding: "6px 0" }}>{fmt(grandTotal)} {form.currency}</div></div>
                <div><label style={{ fontSize: 10.5, color: "var(--muted)" }}>السعر بالعمولة (الصافي للفندق)</label><div style={{ fontWeight: 700, padding: "6px 0", color: "var(--teal)" }}>{fmt(onlineNetAmount(grandTotal, form.paymentDetails.commissionPct))} {form.currency}</div></div>
                {/* الحجز ده مدفوع من خلال منصة حجز (زي Booking.com) مش تحويل
                    مباشر من النزيل - فمفيش "اسم مرسل" أو "رقم محفظة" أصلًا.
                    اسم المنصة نفسها متسجل في "جهة الحجز" فوق، وده بس ملاحظة/
                    كود تأكيد اختياري يخص حجز المنصة. */}
                <div style={{ gridColumn: "1 / -1" }}><label style={{ fontSize: 10.5, color: "var(--muted)" }}>رقم تأكيد الحجز على المنصة / ملاحظة (اختياري)</label><input className="cx-input" placeholder="مثلاً: رقم حجز Booking.com" disabled={chargeLocked} value={form.paymentDetails.ref} onChange={(e) => setForm({ ...form, paymentDetails: { ...form.paymentDetails, ref: e.target.value } })} /></div>
              </div>
            )}
          </div>

          {ONLINE_METHODS.includes(form.paymentMethod) && !form.paymentDetails.onlinePaid && (
            <div className="cx-card" style={{ marginTop: 10, padding: 10, background: "var(--paper2)" }}>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>تفاصيل التحويل المباشر {chargeLocked && <Lock size={10} style={{ verticalAlign: -1 }} />}</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 8 }}>
                <input className="cx-input" placeholder="اسم المرسل" disabled={chargeLocked} value={form.paymentDetails.senderName} onChange={(e) => setForm({ ...form, paymentDetails: { ...form.paymentDetails, senderName: e.target.value } })} />
                <input className="cx-input" placeholder={form.paymentMethod === "فيزا" ? "آخر ٤ أرقام الكارت" : "رقم المحفظة / الهاتف"} disabled={chargeLocked} value={form.paymentDetails.senderNumber} onChange={(e) => setForm({ ...form, paymentDetails: { ...form.paymentDetails, senderNumber: e.target.value } })} />
                <input className="cx-input" placeholder="رقم العملية / ملاحظة" disabled={chargeLocked} value={form.paymentDetails.ref} onChange={(e) => setForm({ ...form, paymentDetails: { ...form.paymentDetails, ref: e.target.value } })} />
              </div>
            </div>
          )}

          {form.paymentDetails.onlinePaid ? (
            <div className="cx-card" style={{ marginTop: 10, padding: 10 }}>
              <div style={{ fontSize: 11, color: "var(--muted)" }}>الإجمالي الكلي (غرفة + رسوم)</div>
              <div style={{ fontWeight: 800, fontSize: 15, padding: "4px 0" }}>{fmt(grandTotal)} {form.currency}</div>
              <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 4 }}>الحجز مدفوع أونلاين - المبلغ ده مش محصّل هنا، خانة المتحصّل والمتبقي مش محتاجة للحجوزات الأونلاين.</div>
            </div>
          ) : (
            <div className="cx-card" style={{ marginTop: 10, padding: 10 }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 8 }}>
                <div><label style={{ fontSize: 11, color: "var(--muted)" }}>الإجمالي الكلي (غرفة + رسوم)</label><div style={{ fontWeight: 800, fontSize: 15, padding: "6px 0" }}>{fmt(grandTotal)} {form.currency}</div></div>
                <div><label style={{ fontSize: 11, color: "var(--muted)" }}>المدفوع حتى الآن {(moneyLocked || collectionLocked) && <Lock size={10} style={{ verticalAlign: -1 }} />}</label><input className="cx-input" type="number" disabled={moneyLocked || collectionLocked} value={form.amountPaid} onChange={(e) => setForm({ ...form, amountPaid: e.target.value })} /></div>
                <div><label style={{ fontSize: 11, color: "var(--muted)" }}>المتبقي على النزيل</label><div style={{ fontWeight: 800, fontSize: 15, padding: "6px 0", color: balanceDue > 0 ? "var(--rust)" : "var(--sage)" }}>{fmt(balanceDue)} {form.currency}</div></div>
                {form.paymentMethod === "كاش" && (<>
                  <div><label style={{ fontSize: 11, color: "var(--muted)" }}>المبلغ المُستلم نقدًا</label><input className="cx-input" type="number" disabled={moneyLocked || collectionLocked} value={form.amountTendered} onChange={(e) => setForm({ ...form, amountTendered: e.target.value })} /></div>
                  <div><label style={{ fontSize: 11, color: "var(--muted)" }}>الباقي (الفكة)</label><div style={{ fontWeight: 800, fontSize: 15, padding: "6px 0" }}>{changeDue != null ? fmt(changeDue) : "—"} {form.currency}</div></div>
                </>)}
              </div>
              {collectionLocked && !moneyLocked && <div style={{ marginTop: 8, fontSize: 11.5, color: "var(--muted)", display: "flex", alignItems: "center", gap: 4 }}><Lock size={11} /> تسجيل التحصيل من صلاحية موظف الشيفت بس - إنت تقدر تحدد سعر الحجز، لكن تأكيد استلام الفلوس يتم من اليومية وقت الشيفت.</div>}
              {/* "متحصّل بالكامل" لازم المدفوع يكون فعليًا وصل للإجمالي الكلي
                  أول - مش علامة حرة تتحط من غير ما الفلوس تكون جت فعلًا (ده
                  كان بيسمح بتضارب: حجز عليه متبقي ومعلّم "متحصّل بالكامل" في
                  نفس الوقت). القفل ده في قاعدة البيانات نفسها كمان (قسم ٢٤
                  في schema.sql). */}
              <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 6 }}><input type="checkbox" disabled={moneyLocked || collectionLocked || balanceDue > 0} checked={form.settled} onChange={(e) => setForm({ ...form, settled: e.target.checked })} /><span style={{ fontSize: 12.5 }}>تم تحصيل كامل المبلغ (مُصفّى)</span></div>
              {!moneyLocked && !collectionLocked && balanceDue > 0 && <div style={{ marginTop: 6, fontSize: 11.5, color: "var(--rust)" }}>مينفعش تعلّمي "متحصّل بالكامل" وفيه {fmt(balanceDue)} {form.currency} لسه متبقية - زوّدي "المدفوع حتى الآن" لحد الإجمالي الكلي الأول.</div>}
            </div>
          )}

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
              <div style={{ fontWeight: 800 }}>{roomLabel(rooms, b.room)} · {b.guestName} {b.paymentDetails?.onlinePaid && <span className="cx-pill" style={{ background: "#EDE8F5", color: "#7A5FB5", marginRight: 6 }}>مدفوع أونلاين</span>} {b.leftEarly && <span className="cx-pill" style={{ background: "#FBE9DA", color: "var(--rust)", marginRight: 6 }}>مشي بدري</span>} {b.duplicatePlacement && <span className="cx-pill" style={{ background: "#EDE8F5", color: "#6B4FA0", marginRight: 6 }}>تسكين مكرر</span>} {b.settled && <span className="cx-pill" style={{ background: "#EAF2EC", color: "var(--sage)", marginRight: 6 }}>متحصّل بالكامل</span>}</div>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>{b.checkin} → {b.checkout} · {nightsBetween(b.checkin, b.checkout)} ليلة · {b.pax} أفراد {b.code && `· كود ${b.code}`}</div>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>{b.source} · {b.paymentMethod}{b.paymentDetails?.senderName ? ` (${b.paymentDetails.senderName} · ${b.paymentDetails.senderNumber})` : ""} · الإجمالي {fmt(gt)} {b.currency} {due > 0 && !b.paymentDetails?.onlinePaid && <span style={{ color: "var(--rust)" }}>· متبقي {fmt(due)}</span>}</div>
            </div>
            <div className="cx-no-print" style={{ display: "flex", alignItems: "center", gap: 8 }}>
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
            <div className="cx-print-only">
              <span className="cx-pill" style={{ background: "#00000010", color: b.status === "ملغي" ? "var(--rust)" : "var(--teal)" }}>{b.status}</span>
            </div>
            {/* حجز ملغي كان عليه مبلغ متحصّل لسه محتاج يترد للنزيل -
                refundPending بيتحدد تلقائيًا في قاعدة البيانات لحظة الإلغاء
                (قسم ٢١ في schema.sql). موظف الشيفت بس يقدر يسجّل إن الفلوس
                فعليًا ارتدت (processRefund فوق). */}
            {b.status === "ملغي" && b.refundPending && (
              <div className="cx-no-print" style={{ width: "100%", marginTop: 4, background: "#FBE2E4", borderRadius: 8, padding: 8, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: 12, color: "var(--rust)", fontWeight: 700 }}><AlertTriangle size={12} style={{ verticalAlign: -1 }} /> حجز ملغي وعليه {fmt(b.amountPaid)} {b.currency} ({b.paymentMethod}) متحصّل - لازم يترد للنزيل</span>
                {!perms.markPaymentReceived ? (
                  <span style={{ fontSize: 11, color: "var(--muted)" }}>محتاج موظف الشيفت يسجّل رد الفلوس</span>
                ) : (perms.roomStatusRestricted && offShift) ? (
                  <span style={{ fontSize: 11, color: "var(--muted)" }}>{shiftClosed ? "شيفتك مقفول" : "مش شيفتك دلوقتي"}</span>
                ) : (
                  <TwoStepButton label="تسجيل رد الفلوس" confirmLabel="تأكيد رد الفلوس؟" onConfirm={() => processRefund(b)} />
                )}
              </div>
            )}
          </div>
        ); })}
      </div>

      <div className="cx-print-only cx-print-footer">
        <div className="cx-print-sign">
          <span>توقيع المسؤول: ______________________</span>
          <span>الختم:</span>
        </div>
        <div className="cx-print-generated">تم إصدار هذا المستند أوتوماتيكيًا من نظام إدارة الفندق Calma</div>
      </div>
    </div>
  );
}
