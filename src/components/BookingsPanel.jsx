import React, { useState, useEffect } from "react";
import { Pencil, Ban, AlertTriangle, Check, Plus, Printer, Lock } from "lucide-react";
import { AutoText, TwoStepButton, PaymentDetailsInline, Logo, GuestCodeChips, GuestCodeHits, RefundBox, MoneyBox, PayBreakdown } from "./shared";
import { fmt, COMMON_CURRENCIES, PAYMENT_METHODS, emptyPaymentDetails, cleanPaymentDetailsFor, validatePaymentDetailsFor, bookingAmountDue, bookingGrandTotal, bookingHotelTotal, refundStatusOf } from "../domain/money";
import { todayStr, addDays, nightsBetween, uid, arabicDateLong } from "../domain/dates";
import { sourceOptionsFor, BOOKING_STATUSES, HOTEL_NAME, roomLabel } from "../domain/constants";
import { findOverlappingBookings, planDuplicateResolution, repricedTotalRoom, earlyLeavePatch, normalizeGuestCodes, duplicateGuestCode, findGuestCodeHits, guestCodeEntries, findGuestCodeConflict, nextGuestNumber } from "../domain/bookingLogic";
import { useShiftGate } from "../hooks/useShiftGate";
import { getPaymentsIndex } from "../data/shifts";
import { recordBookingPayment } from "../data/payments";
import { guarded } from "../lib/busy";
import { sanitizeText } from "../domain/security";

function emptyBooking() {
  return { id: uid(), code: "", room: "", guestName: "", phone: "", pax: 1, guestCodes: [""], checkin: todayStr(), checkout: addDays(todayStr(), 1), priceNight: "", currency: "USD", totalRoom: "", extras: { laundry: "", cafeteria: "", tours: "", pickup: "" }, earlyCheckin: { applied: false, fee: "", note: "" }, paymentMethod: "كاش", paymentDetails: emptyPaymentDetails(), amountPaid: "", source: "مباشر", status: "مؤكد", approvalStatus: "approved", notes: "", imported: false, needsRoomReview: false,
    // دفعة مقدّمة (اختيارية) وقت إضافة الحجز - كل دفعة ليها وسيلتها وتفاصيلها (آخر ٤ أرقام الفيزا / اسم ورقم المحوِّل) وبتتسجّل في اليومية بيهم
    payNow: { amount: "", method: "كاش", details: emptyPaymentDetails() } };
}

/* تسجيل دفعة (عربون/سداد) على حجز موجود من قايمة الحجوزات - لموظف الشيفت: قبل كده التحصيل كان من لوحة الغرف بس (حجوزات اليوم وبعده بيومين)،
   فعربون على حجز بعيد (أكتر من يومين) ماكانش ليه مكان يتسجّل فيه خالص. الدفعة بتتسجّل بنفس الدالة الذرية (الحجز + اليومية). */
function QuickPay({ booking, onDone, showToast }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("كاش");
  const [details, setDetails] = useState(emptyPaymentDetails());
  const due = bookingAmountDue(booking);
  async function submit() {
    return guarded("quickpay:" + booking.id, async () => {
      const amt = Math.round((amount === "" ? due : Number(amount) || 0) * 100) / 100;
      if (!(amt > 0)) { showToast("اكتب مبلغ الدفعة (أكبر من صفر)"); return; }
      if (amt > due + 0.005) { showToast(`المبلغ (${fmt(amt)}) أكبر من المتبقي على النزيل (${fmt(due)} ${booking.currency})`); return; }
      const err = validatePaymentDetailsFor(method, details);
      if (err) { showToast(err); return; }
      const res = await recordBookingPayment({ bookingId: booking.id, amount: amt, method, details: cleanPaymentDetailsFor(method, details), note: "تحصيل", expectedUpdatedAt: booking.updatedAt });
      if (res.error) { showToast(res.error); if (onDone) await onDone(); return; }
      if (onDone) await onDone();
      setOpen(false); setAmount(""); setDetails(emptyPaymentDetails()); setMethod("كاش");
      showToast(`تم تسجيل ${fmt(amt)} ${booking.currency} (${method}) على ${booking.guestName} - المتبقي ${fmt(Math.max(0, due - amt))} ${booking.currency}`);
    });
  }
  if (!open) return <button className="cx-btn cx-btn-gold" style={{ fontSize: 12 }} data-testid="quickpay-open" onClick={() => setOpen(true)}>تسجيل دفعة</button>;
  return (
    <div data-testid="quickpay-panel" style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", background: "var(--paper2)", borderRadius: 8, padding: 6 }}>
      <span style={{ fontSize: 11.5 }}>المتبقي {fmt(due)} {booking.currency}</span>
      <input className="cx-input" data-testid="quickpay-amount" type="number" min="0" placeholder={`المبلغ (${fmt(due)})`} style={{ width: 100 }} value={amount} onChange={(e) => setAmount(e.target.value)} />
      <select className="cx-select" data-testid="quickpay-method" style={{ width: 130 }} value={method} onChange={(e) => { setMethod(e.target.value); setDetails(emptyPaymentDetails()); }}>{PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}</select>
      <PaymentDetailsInline method={method} details={details} onChange={setDetails} testid="quickpay" />
      <button className="cx-btn cx-btn-gold" data-testid="quickpay-submit" onClick={submit}>سجّل</button>
      <button className="cx-btn cx-btn-outline" onClick={() => setOpen(false)}>إلغاء</button>
    </div>
  );
}

export function BookingsPanel({ rooms, bookings, perms, role, profile, onInsertBooking, onUpdateBooking, onRefresh, onDecideRefund, onLog, showToast, pendingEditId, onConsumeEditRequest, dataVersion }) {
  const [form, setForm] = useState(null);
  const formBaseRef = React.useRef(null);   // نسخة الحجز اللي الفورم اتفتح عليها (لدمج تعديلاتي مع آخر نسخة لو اتغيّر من مكان تاني)
  const [filter, setFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");      // all | active | cancelled
  const [payIndex, setPayIndex] = useState(null);                // المدفوع بالوسيلة لكل حجز (من اليومية)
  // نفس هوك شيفت موظف الشيفت المستخدم في RoomBoard.jsx بالظبط - عشان لو
  // شيفته مش حاجزه دلوقتي أو شيفته مقفول، ميعرفش يضيف أو يعدّل أي حجز من هنا
  // برده (مش بس من بلوك الغرف)، ومن غير أي تضارب بين الشاشتين.
  const { offShift, shiftClosed, myActiveShiftKey } = useShiftGate(profile, perms, dataVersion);

  useEffect(() => {
    if (pendingEditId) {
      const b = bookings.find((x) => x.id === pendingEditId);
      if (b) { const f = formFromBooking(b); formBaseRef.current = f; setForm(f); }
      onConsumeEditRequest();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- بيشتغل مرة لما يوصل طلب تعديل (pendingEditId) - إضافة bookings كانت هتعيد فتح الفورم مع كل تحديث
  }, [pendingEditId]);

  useEffect(() => {
    let cancelled = false;
    (async () => { const idx = await getPaymentsIndex(bookings); if (!cancelled && idx) setPayIndex(idx); })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataVersion, bookings.length, JSON.stringify(bookings.map((b) => b.amountPaid))]);

  function startNew() { setForm(emptyBooking()); }
  function formFromBooking(b) { return { ...b, guestCodes: normalizeGuestCodes(b.guestCodes, b.pax), extras: b.extras || { laundry: "", cafeteria: "", tours: "", pickup: "" }, earlyCheckin: b.earlyCheckin || { applied: false, fee: "", note: "" }, paymentDetails: b.paymentDetails || emptyPaymentDetails(), payNow: { amount: "", method: "كاش", details: emptyPaymentDetails() } }; }
  function startEdit(b) { const f = formFromBooking(b); formBaseRef.current = f; setForm(f); }

  const isExistingBooking = form ? bookings.some((b) => b.id === form.id) : false;
  const originalBooking = form && isExistingBooking ? bookings.find((b) => b.id === form.id) : null;
  const moneyLocked = role === "reservations" && isExistingBooking;
  // مدير الحجوزات يضيف حجز ويحدد سعره عادي (فوق)، لكن "استلمنا الفلوس فعليًا
  // ولا لأ" (المدفوع) مش شغله خالص - ده قرار موظف الشيفت اللي قدام النزيل
  // فعليًا. القفل ده شامل حتى وقت إنشاء حجز جديد، مش بس وقت تعديل حجز قديم.
  // حالة الدفع (مدفوع بالكامل / متبقي) بتتحسب لوحدها من المدفوع والإجمالي -
  // مفيش علامة "متحصّل" بتتعلّم بالإيد ولا بتقفل حاجة.
  const collectionLocked = role === "reservations";
  const chargeLocked = moneyLocked;
  // الدخول المبكر ممكن يتسجّل على حجز موجود لسه ماتسجّلش عليه (حتى لو التسعير مقفول)؛ لو اتسجّل قبل كده بيتقفل زي باقي الرسوم.
  const earlyLocked = chargeLocked && !(isExistingBooking && !originalBooking?.earlyCheckin?.applied);

  // الغرفة بقت بس رقم - مفيش سعر ثابت أو نوع متسجل عليها نرجع نعبّي بيه
  // السعر/العملة تلقائيًا؛ الموظف بيكتب سعر الليلة والعملة بنفسه كل مرة حسب
  // الاتفاق مع النزيل.
  function onRoomChange(roomNum) { setForm((f) => ({ ...f, room: Number(roomNum) })); }

  const nights = form ? nightsBetween(form.checkin, form.checkout) : 0;
  const autoTotalRoom = form ? (Number(form.priceNight) || 0) * nights : 0;
  // لما مدير الحجوزات يعدّل تواريخ حجز موجود (تمديد/تقصير)، إجمالي الغرفة بيتحرك
  // تلقائيًا بنفس سعر الليلة المتفق عليه - من غير ما يحتاج يفتح قفل الأسعار
  // (القفل لسه موجود على السعر نفسه). null = مفيش إعادة حساب (حجز جديد).
  const lockedRepricedTotal = form && chargeLocked && originalBooking ? repricedTotalRoom(originalBooking, form.checkin, form.checkout) : null;
  const roomTotalNow = lockedRepricedTotal != null ? lockedRepricedTotal : (Number(form?.totalRoom || autoTotalRoom) || 0);
  const earlyFee = form && form.earlyCheckin?.applied ? Number(form.earlyCheckin.fee) || 0 : 0;
  const grandTotal = form ? roomTotalNow + (Number(form.extras.laundry) || 0) + (Number(form.extras.cafeteria) || 0) + (Number(form.extras.tours) || 0) + (Number(form.extras.pickup) || 0) + earlyFee : 0;
  // اللي اتدفع قبل كده (حجز موجود) + الدفعة المقدّمة دلوقتي (حجز جديد بس)
  const paidBefore = isExistingBooking ? Number(originalBooking?.amountPaid) || 0 : 0;
  const advanceNow = form && !isExistingBooking ? Math.max(0, Number(form.payNow?.amount) || 0) : 0;
  const balanceDue = form ? Math.max(0, grandTotal - paidBefore - advanceNow) : 0;
  // كل الحجوزات الفعلية المتعارضة مع الغرفة/التواريخ دي، والخطة اللي هتتنفذ
  // لو تأكّد "تسكين مكرر" - بتتحسب لحظيًا عشان الموظف يشوف قبل ما يحفظ إيه اللي
  // هيحصل بالظبط للحجز القديم (أو ليه مرفوض وليه).
  const clashesNow = form && form.room ? findOverlappingBookings(bookings, Number(form.room), form.checkin, form.checkout, form.id) : [];
  const conflict = clashesNow.length > 0;
  const duplicatePlan = conflict ? planDuplicateResolution(clashesNow, form.checkin, todayStr()) : null;
  const clashLabel = (c) => `${c.guestName || "—"} (${c.checkin} → ${c.checkout})`;
  const duplicateBlockedText = (plan) => {
    const c = clashLabel(plan.clash);
    if (plan.reason === "future") return `الحجز ${c} لسه ماجاش معاده (بعد النهارده) - ده حجز مزدوج حقيقي مش خروج مبكر، مينفعش يتسكّن مكرر. لازم مدير الحجوزات يلغيه الأول من شاشة الحجوزات.`;
    if (plan.reason === "new_in_future") return `الحجز ${c} نزيله لسه في الغرفة، والحجز الجديد بيبدأ بعد النهارده - ده مش خروج مبكر. لو النزيل هيخرج بدري فعلاً، مدير الحجوزات يعدّل تاريخ خروجه الأول.`;
    return `تاريخ دخول الحجز الجديد قبل دخول الحجز القديم ${c} على نفس الغرفة - صحّح التواريخ.`;
  };

  // بيرجّع الحجوزات القديمة لحالتها الأصلية لو حفظ الحجز الجديد فشل بعد ما
  // اتنفّذ تسكينها (تقصير/إلغاء) - عشان الغرفة ماتفضلش من غير نزيل في النظام.
  async function rollbackResolved(done) {
    let allOk = true;
    for (const d of [...done].reverse()) {
      const r = await onUpdateBooking(d.updated.id, { ...d.updated, checkout: d.original.checkout, totalRoom: d.original.totalRoom, status: d.original.status, leftEarly: d.original.leftEarly, notes: d.original.notes });
      if (r?.error) allOk = false;
    }
    return allOk;
  }

  async function saveBooking() { return guarded("save-booking", saveBookingInner); }
  async function saveBookingInner() {
    if (perms.roomStatusRestricted && offShift) { showToast(shiftClosed ? "شيفتك مقفول - لازم المدير العام أو مدير الحجوزات يفتحوه تاني عشان تقدر تضيف أو تعدّل حجز" : "مش شيفتك دلوقتي - الحجوزات بتتضاف/تتعدل وقت شيفتك اللي حاجزه بس"); return; }
    if (!form.room || !form.guestName.trim()) { showToast("لازم تحدد الغرفة واسم النزيل"); return; }
    // الحجز اتعدّل من مكان تاني (غالبًا تحصيل من موظف الشيفت) وإحنا فاتحين
    // الفورم: نحدّث نسخته المرجعية ونطلب مراجعة، بدل ما كل حفظة بعد كده تفشل
    // بـ"تعارض" والفورم يفضل متعلّق على نسخة قديمة.
    if (isExistingBooking && originalBooking && form.updatedAt && originalBooking.updatedAt && form.updatedAt !== originalBooking.updatedAt) {
      // دمج ثلاثي: الحجز اتحدّث من مكان تاني (تمديد/تحصيل/رسوم)، فنحمّل آخر نسخة كاملة ونفضّل بس على الخانات اللي انت غيّرتها
      // بنفسك (مقارنة بالنسخة اللي فتحت عليها) - الحفظة الجاية ما بترجّعش تغيير حد تاني ولا بتضيّع تعديلك.
      const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
      const fresh = formFromBooking(originalBooking), base = formBaseRef.current || {}, merged = { ...fresh };
      Object.keys(form).forEach((k) => {
        if (k === "updatedAt" || k === "amountPaid" || same(form[k], base[k])) return;
        if (["extras", "earlyCheckin", "paymentDetails"].includes(k) && form[k] && base[k] && typeof form[k] === "object") {
          merged[k] = { ...fresh[k] };
          Object.keys(form[k]).forEach((kk) => { if (!same(form[k][kk], base[k][kk])) merged[k][kk] = form[k][kk]; });
        } else merged[k] = form[k];
      });
      formBaseRef.current = fresh;
      setForm(merged);
      showToast("الحجز ده اتحدّث من مكان تاني وانت بتعدّل فيه - حمّلنا آخر نسخة وحافظنا على تعديلاتك، راجع القيم واضغط حفظ تاني");
      return;
    }
    // تاريخ الخروج لازم يكون بعد تاريخ الدخول - من غير الفحص ده هنوصل لقيد
    // قاعدة البيانات (bookings_dates_valid) وتظهر رسالة تقنية مش مفهومة.
    const zeroNightOk = isExistingBooking && !!originalBooking?.leftEarly && form.checkout === form.checkin;
    if (!form.checkin || !form.checkout || form.checkout < form.checkin || (form.checkout === form.checkin && !zeroNightOk)) { showToast("تاريخ الخروج لازم يكون بعد تاريخ الدخول"); return; }
    // الغرفة عليها نزيل: لو ده خروج مبكر شرعي (النزيل القديم دخل فعلاً) الحفظ بيسجّل خروجه المبكر ويسكّن الجديد
    // تلقائيًا (الموظف شايف اللي هيحصل قبل الضغط). لو حجز مستقبلي/تواريخ غلط => مرفوض بسبب واضح ومفيش حاجة بتتغيّر.
    if (conflict && duplicatePlan && !duplicatePlan.ok) {
      showToast(duplicateBlockedText(duplicatePlan));
      return;
    }
    // منع أي قيمة سالبة في الرسوم الإضافية/رسم الدخول المبكر من غير داعي
    // تضرب قيد قاعدة البيانات وتطلّع رسالة خطأ تقنية مش مفهومة.
    const clampedExtras = { laundry: Math.max(0, Number(form.extras.laundry) || 0), cafeteria: Math.max(0, Number(form.extras.cafeteria) || 0), tours: Math.max(0, Number(form.extras.tours) || 0), pickup: Math.max(0, Number(form.extras.pickup) || 0), ...(form.extras.cafeteriaPaid != null ? { cafeteriaPaid: form.extras.cafeteriaPaid } : {}) };
    const clampedEarlyCheckin = { ...form.earlyCheckin, fee: Math.max(0, Number(form.earlyCheckin?.fee) || 0) };
    // أرقام غلط (سالبة/كسور/نص) بتتصلّح هنا قبل الحفظ بدل ما توصل لقيود قاعدة
    // البيانات وتطلّع رسالة تقنية، ونصوص الحقول الحرة بتتنظّف وتتحدد بطول أقصى.
    const pd = form.paymentDetails || {};
    const priceNightNum = Math.max(0, Number(form.priceNight) || 0);
    const totalRoomNum = form.totalRoom !== "" ? Number(form.totalRoom) : autoTotalRoom;
    if (!Number.isFinite(totalRoomNum) || totalRoomNum < 0) { showToast("إجمالي الغرفة لازم يكون رقم صحيح مش سالب"); return; }
    // الدفعة المقدّمة (حجز جديد بس، وموظف الشيفت بس): ليها وسيلتها وتفاصيلها
    // المخصوصة (فيزا = آخر ٤ أرقام، تحويل = اسم + رقم) وبتتسجّل في اليومية بيهم.
    const online = !!pd.onlinePaid;
    const payNow = form.payNow || { amount: "", method: "كاش", details: emptyPaymentDetails() };
    const advance = !isExistingBooking && !collectionLocked && !online ? Number(payNow.amount) || 0 : 0;
    if (!Number.isFinite(advance) || advance < 0) { showToast("المدفوع لازم يكون رقم صحيح مش سالب"); return; }
    if (advance > 0 && !myActiveShiftKey) { showToast("مفيش شيفتك شغال دلوقتي - ماينفعش تسجّل دفعة مقدّمة. احفظ الحجز من غير دفعة وسجّلها بعد ما تفتح شيفتك"); return; }
    if (advance > 0) {
      const detailsErr = validatePaymentDetailsFor(payNow.method, payNow.details);
      if (detailsErr) { showToast(detailsErr); return; }
    }
    const payMethod = advance > 0 ? payNow.method : (originalBooking?.paymentMethod || "كاش");
    const cleanPaymentDetails = online
      ? { ...emptyPaymentDetails(), onlinePaid: true, ref: sanitizeText(pd.ref, 200) }
      : advance > 0 ? cleanPaymentDetailsFor(payNow.method, payNow.details) : (originalBooking?.paymentDetails || emptyPaymentDetails());
    let cleaned = {
      ...form, room: Number(form.room), guestName: sanitizeText(form.guestName, 120), phone: sanitizeText(form.phone, 40), code: sanitizeText(form.code, 60), notes: sanitizeText(form.notes, 1000),
      pax: Math.max(1, Math.floor(Number(form.pax) || 1)), priceNight: priceNightNum, totalRoom: totalRoomNum, amountPaid: isExistingBooking ? Number(originalBooking?.amountPaid) || 0 : 0,
      extras: clampedExtras, earlyCheckin: { ...clampedEarlyCheckin, note: sanitizeText(clampedEarlyCheckin.note, 300) }, paymentMethod: payMethod, paymentDetails: cleanPaymentDetails, needsRoomReview: false, approvalStatus: "approved",
    };
    delete cleaned.payNow;
    if (!cleaned.guestName) { showToast("لازم تحدد الغرفة واسم النزيل"); return; }
    cleaned.guestCodes = normalizeGuestCodes(Array.from({ length: cleaned.pax }, (_, i) => sanitizeText(form.guestCodes?.[i] ?? "", 40)), cleaned.pax);
    const monthClash = findGuestCodeConflict(bookings, cleaned.guestCodes, cleaned.checkin, cleaned.id);
    if (monthClash) { showToast(`الكود ${monthClash.code} مستخدم الشهر ده بالفعل (غرفة ${monthClash.room} - ${monthClash.guestName}) - اختار كود تاني`); return; }
    const dupCode = duplicateGuestCode(cleaned.guestCodes);
    if (dupCode) { showToast(`الكود ${dupCode} مكتوب لأكتر من فرد في نفس الحجز - كل فرد ليه كود مختلف`); return; }
    // مدير الحجوزات بيعدّل حجز قديم: قيمة الحجز (سعر/رسوم/وسيلة دفع) تفضل زي ما هي
    // حتى لو الواجهة اتلعب فيها (القفل الحقيقي في قاعدة البيانات - قسم ١٤/١٥).
    // الاستثناء الوحيد إجمالي الغرفة: بيتحرك مع عدد الليالي بنفس سعر الليلة.
    if (chargeLocked && originalBooking) {
      cleaned = { ...cleaned, priceNight: originalBooking.priceNight, currency: originalBooking.currency, totalRoom: lockedRepricedTotal, extras: originalBooking.extras, earlyCheckin: originalBooking.earlyCheckin?.applied ? originalBooking.earlyCheckin : cleaned.earlyCheckin, paymentMethod: originalBooking.paymentMethod, paymentDetails: originalBooking.paymentDetails };
    }
    // الدفعة المقدّمة ماتزيدش عن اللي الفندق مطلوب يحصّله
    if (advance > 0 && advance > bookingHotelTotal(cleaned)) { showToast(`المدفوع (${fmt(advance)}) أكبر من الإجمالي (${fmt(bookingHotelTotal(cleaned))} ${cleaned.currency})`); return; }
    // "تسكين مكرر" (الخطة اتأكدت فوق إنها سليمة): لكل حجز قديم متعارض -
    // - بدأ قبل الجديد: نقصّر تاريخ خروجه لتاريخ دخول الجديد ونعلّمه "غادر مبكرًا"
    //   (مش "ملغي"؛ بيتحاسب على الليالي اللي قعدها والزيادة المدفوعة طلب رد).
    // - نزل نفس يوم الجديد وخرج: بيتسجّل "غادر مبكرًا" برضه (خروجه = دخوله)
    //   وبيتحاسب ليلة واحدة (الحد الأدنى).
    // لو حفظ الحجز الجديد فشل بعد كده، كل اللي اتغيّر بيترجع تاني تلقائيًا.
    const resolved = [];
    const refundRequests = [];
        if (conflict && duplicatePlan?.ok) {
      for (const act of duplicatePlan.actions) {
        const c = act.clash;
        const patch = earlyLeavePatch(c, act.checkout);
        const r = await onUpdateBooking(c.id, { ...c, ...patch });
        if (r?.error) {
          const undone = await rollbackResolved(resolved);
          showToast(`تعذر تسكين الحجز القديم ${clashLabel(c)}: ${r.error}${resolved.length ? (undone ? " - اتراجع عن اللي اتغيّر قبله" : " - ⚠ في حجز اتغيّر قبله ومتراجعش، راجع الحجوزات") : ""}`);
          return;
        }
        resolved.push({ original: c, updated: r.data || { ...c, ...patch } });
        const savedOld = r.data || { ...c, ...patch };
        if ((Number(savedOld.amountPaid) || 0) > bookingGrandTotal(savedOld)) refundRequests.push(savedOld);
        onLog(`تسكين مكرر - ${roomLabel(rooms, c.room)} - ${c.guestName}: غادر مبكرًا ${act.action === "trim" ? `(خروج ${act.checkout})` : "(نفس يوم الدخول)"}`);
      }
      cleaned = { ...cleaned, duplicatePlacement: true };
    }
    const res = isExistingBooking ? await onUpdateBooking(cleaned.id, cleaned) : await onInsertBooking(cleaned);
    if (res?.error) {
      if (resolved.length) {
        const undone = await rollbackResolved(resolved);
        showToast(undone
          ? `تعذر حفظ الحجز الجديد: ${res.error} - الحجز القديم رجع زي ما كان، حاول تاني`
          : `⚠ تعذر حفظ الحجز الجديد: ${res.error} - والحجز القديم اتسجّل "غادر مبكرًا" ومترجعش تلقائيًا: راجع شاشة الحجوزات وضيف الحجز الجديد تاني فورًا`);
        return;
      }
      showToast(res.error); return;
    }
    onLog(`${isExistingBooking ? "تعديل" : "إضافة"} حجز ${roomLabel(rooms, cleaned.room)} — ${cleaned.guestName}${conflict ? " (تسكين مكرر)" : ""}`);
    // لو اتحصّل مبلغ مقدّم وقت إضافة حجز جديد (نزيل مباشر دافع عند موظف
    // الشيفت) سجّله تلقائيًا في يومية شيفته النهارده - عشان رصيد الخزينة/
    // التحصيل حسب طريقة الدفع يعكس الحقيقة من غير ما يحتاج يكتبه تاني يدويًا
    // في اليومية (انظر appendBookingCollection في data/shifts.js). ده صفر
    // دايمًا لو مدير الحجوزات هو اللي عدّل/أضاف (collectionLocked بيصفّر
    // amountPaid له فوق في الحالتين).
    const savedId = res.data?.id || cleaned.id;
    let note = "";
    let payFailed = "";
    // الدفعة المقدّمة بتتسجّل بعملية ذرية في القاعدة (الحجز + اليومية + كافيتيريا النزيل) بعد حفظ الحجز
    if (advance > 0) {
      const payRes = await recordBookingPayment({ bookingId: savedId, amount: advance, method: payMethod, details: cleaned.paymentDetails, note: "تحصيل حجز جديد", expectedUpdatedAt: res.data?.updatedAt });
      if (payRes.error) { payFailed = `⚠ الحجز اتحفظ لكن الدفعة (${fmt(advance)} ${cleaned.currency} - ${payMethod}) ماتسجّلتش: ${payRes.error} - سجّلها من زرار "تسجيل دفعة" على الحجز في القايمة`; }
      else if (onRefresh) await onRefresh();
    }
    refundRequests.forEach((c) => { note += ` — ${c.guestName} غادر مبكرًا: اتحاسب على الليالي اللي قعدها، و${fmt((Number(c.amountPaid) || 0) - bookingGrandTotal(c))} ${c.currency} زيادة مدفوعة عن الليالي اللي ماقعدهاش اتبعتت كطلب رد فلوس لمدير الحجوزات`; });
    const paidAfter = Number(cleaned.amountPaid) || 0;
    if (!cleaned.paymentDetails?.onlinePaid && isExistingBooking && paidAfter > bookingGrandTotal(cleaned) && cleaned.status !== "ملغي") note += ` — ⚠ المدفوع (${fmt(paidAfter)}) بقى أكبر من الإجمالي الجديد بـ ${fmt(paidAfter - bookingGrandTotal(cleaned))} ${cleaned.currency} - فيه فلوس زيادة لازم تترد للنزيل`;
    if (cleaned.status === "ملغي" && originalBooking?.status !== "ملغي" && paidAfter > 0) note += ` — الحجز اتلغى وفيه ${fmt(paidAfter)} ${cleaned.currency} متحصّل: اتبعت طلب رد فلوس لمدير الحجوزات (هو اللي يقرر يرد أو يرفض، ولو رد بيتشال من التحصيل واليومية)`;
    // حجز اتلغى وعليه فلوس: ماينفعش طلب الرد يختفي من القايمة بسبب فلتر "الشغّالة" أو نص بحث
    if (cleaned.status === "ملغي" && originalBooking?.status !== "ملغي" && paidAfter > 0) { if (statusFilter === "active") setStatusFilter("all"); setFilter(""); }
    setForm(null); showToast(payFailed ? payFailed + note : "تم الحفظ" + note);
  }
  // إلغاء حجز (مش مسح): الحجز بيفضل ظاهر في "الحجوزات الملغية"، ولو عليه فلوس متحصّلة قاعدة البيانات
  // بتفتح طلب رد فلوس لمدير الحجوزات تلقائيًا. مفيش مسح نهائي للحجز من الشاشة عشان أثره المالي ما يختفيش.
  async function cancelBooking(b) {
    const res = await onUpdateBooking(b.id, { ...b, status: "ملغي" });
    if (res?.error) { showToast(res.error); return; }
    if (res?.conflict) { showToast("الحجز اتعدّل من مكان تاني - راجع الحجوزات وجرّب تاني"); return; }
    const saved = res?.data || { ...b, status: "ملغي" };
    onLog(`إلغاء حجز ${roomLabel(rooms, b.room)} — ${b.guestName}`);
    const rs = refundStatusOf(saved);
    if (statusFilter === "active") setStatusFilter("all");        // ماينفعش الحجز اللي لسه اتلغى يختفي من القايمة اللي قدامه
    showToast(`تم إلغاء الحجز - هتلاقيه في "الحجوزات الملغية" (وفي "الكل"). ${rs ? rs.text : ""}`);
  }

  const q = filter.trim().toLowerCase();
  // لو اللي مكتوب في البحث هو كود فرد بالظبط => نعرض الحجز والغرفة اللي كان ساكن فيها
  const codeHits = findGuestCodeHits(bookings, q);
  const counts = { all: bookings.length, active: bookings.filter((b) => b.status !== "ملغي").length, cancelled: bookings.filter((b) => b.status === "ملغي").length };
  const list = bookings.filter((b) => {
    if (statusFilter === "active" && b.status === "ملغي") return false;
    if (statusFilter === "cancelled" && b.status !== "ملغي") return false;
    if (q && !String(b.room).includes(q) && !(b.guestName || "").toLowerCase().includes(q) && !(b.code && b.code.toLowerCase().includes(q)) && !guestCodeEntries(b).some((g) => g.code.toLowerCase().includes(q))) return false;
    if (dateFrom && (b.checkout < dateFrom || (b.checkout === dateFrom && b.checkin !== b.checkout))) return false;
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
        <div className="cx-card cx-no-print" data-calma-editing="booking" style={{ padding: 14, marginBottom: 14 }}>
          {form.code && <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>كود الحجز: <span dir="ltr" data-testid="booking-code" style={{ fontFamily: "monospace", fontWeight: 700 }}>{form.code}</span></div>}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 8 }}>

            <div><label style={{ fontSize: 11, color: "var(--muted)" }}>الغرفة</label><select className="cx-select" value={form.room} onChange={(e) => onRoomChange(e.target.value)}><option value="">اختر</option>{rooms.map((r) => <option key={r.number} value={r.number}>{r.name || `غرفة ${r.number}`}</option>)}</select></div>
            <div><label style={{ fontSize: 11, color: "var(--muted)" }}>اسم النزيل</label><AutoText className="cx-input" value={form.guestName} onChange={(e) => setForm({ ...form, guestName: e.target.value })} /></div>
            <div><label style={{ fontSize: 11, color: "var(--muted)" }}>الهاتف</label><input className="cx-input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
            <div><label style={{ fontSize: 11, color: "var(--muted)" }}>عدد الأفراد</label><input className="cx-input" type="number" min="1" value={form.pax} onChange={(e) => setForm({ ...form, pax: e.target.value })} /></div>
            <div style={{ gridColumn: "1 / -1" }} data-testid="guest-code-inputs">
              <label style={{ fontSize: 11, color: "var(--muted)" }}>كود لكل فرد (اختياري - فريد جوه الشهر)</label>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(130px,1fr))", gap: 6, marginTop: 2 }}>
                {Array.from({ length: Math.min(100, Math.max(1, Math.floor(Number(form.pax) || 1))) }, (_, i) => (
                  <input key={i} className="cx-input" data-testid={`guest-code-input-${i + 1}`} dir="ltr" maxLength={40} placeholder={`كود الفرد ${i + 1}`} value={form.guestCodes?.[i] ?? ""} onChange={(e) => { const next = normalizeGuestCodes(form.guestCodes, form.pax); next[i] = e.target.value; setForm({ ...form, guestCodes: next }); }} />
                ))}
              </div>
              <div style={{ marginTop: 4, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: 11.5, color: "var(--muted)" }}>
                <span data-testid="next-guest-number">الرقم التالي المتاح الشهر ده: {nextGuestNumber(bookings, form.checkin, form.id)} (العداد بيبدأ من ١ كل شهر)</span>
                <button type="button" className="cx-btn cx-btn-outline" data-testid="guest-codes-auto" style={{ fontSize: 11, padding: "2px 8px" }} onClick={() => {
                  const cur = normalizeGuestCodes(form.guestCodes, form.pax);
                  let n = nextGuestNumber(bookings, form.checkin, form.id);
                  const used = new Set(cur.filter(Boolean).map((c) => c.toUpperCase()));
                  const filled = cur.map((c) => { if (c) return c; while (used.has(String(n))) n += 1; return String(n++); });
                  setForm({ ...form, guestCodes: filled });
                }}>املا الفاضي تلقائيًا</button>
              </div>
            </div>
            <div><label style={{ fontSize: 11, color: "var(--muted)" }}>تاريخ الدخول</label><input className="cx-input" type="date" value={form.checkin} onChange={(e) => { const newCheckin = e.target.value; setForm((f) => ({ ...f, checkin: newCheckin, checkout: f.checkout && f.checkout > newCheckin ? f.checkout : addDays(newCheckin, 1) })); }} /></div>
            <div><label style={{ fontSize: 11, color: "var(--muted)" }}>تاريخ الخروج</label><input className="cx-input" type="date" min={form.checkin ? addDays(form.checkin, 1) : undefined} value={form.checkout} onChange={(e) => setForm({ ...form, checkout: e.target.value })} /></div>
            <div><label style={{ fontSize: 11, color: "var(--muted)" }}>السعر لليلة {chargeLocked && <Lock size={10} style={{ verticalAlign: -1 }} />}</label><div style={{ display: "flex", gap: 4 }}><input className="cx-input" type="number" disabled={chargeLocked} value={form.priceNight} onChange={(e) => setForm({ ...form, priceNight: e.target.value })} /><select className="cx-select" disabled={chargeLocked} value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} style={{ width: 90 }}>{COMMON_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}</select></div></div>
            <div><label style={{ fontSize: 11, color: "var(--muted)" }}>إجمالي الغرفة ({nights} ليلة) {chargeLocked && <Lock size={10} style={{ verticalAlign: -1 }} />}</label><input className="cx-input" type="number" disabled={chargeLocked} placeholder={String(autoTotalRoom)} value={lockedRepricedTotal != null ? lockedRepricedTotal : form.totalRoom} onChange={(e) => setForm({ ...form, totalRoom: e.target.value })} /></div>

            {/* الحالة (ومعاها "ملغي") من صلاحية مدير الحجوزات بس - موظف
                الشيفت وقت إضافة حجز جديد (walk-in) مش بيشوف الاختيار ده
                خالص، فيفضل الحجز "مؤكد" بالقيمة الافتراضية. ده غير القفل
                الحقيقي في قاعدة البيانات نفسها (قسم ٢٣ في schema.sql) اللي
                بيمنع موظف الشيفت من كتابة "ملغي" حتى لو حد حاول يتخطى
                الواجهة. */}

          </div>

          {moneyLocked && <div style={{ marginTop: 10, fontSize: 12, color: "var(--muted)", background: "var(--paper2)", borderRadius: 8, padding: 8, display: "flex", gap: 6, alignItems: "center" }}><Lock size={13} /> السعر والرسوم والمدفوع بيتقفلوا بعد حفظ الحجز. لو فيه غلط في السعر: الغي الحجز (لو عليه فلوس بيتفتح طلب رد) واعمل حجز جديد بالقيم الصح. تسجيل الدفعات بيتم من موظف الشيفت.</div>}

          {lockedRepricedTotal != null && originalBooking && lockedRepricedTotal !== (Number(originalBooking.totalRoom) || 0) && (
            <div style={{ marginTop: 10, fontSize: 12, color: "var(--teal)", background: "var(--paper2)", borderRadius: 8, padding: 8 }}>
              عدد الليالي اتغيّر ({nightsBetween(originalBooking.checkin, originalBooking.checkout)} ← {nights}) - إجمالي الغرفة اتحرك تلقائيًا من {fmt(originalBooking.totalRoom)} إلى {fmt(lockedRepricedTotal)} {form.currency} بنفس سعر الليلة.
            </div>
          )}
          {form.status === "ملغي" && (isExistingBooking ? originalBooking?.status !== "ملغي" : true) && (Number(isExistingBooking ? originalBooking?.amountPaid : form.amountPaid) || 0) > 0 && (
            <div style={{ marginTop: 10, fontSize: 12, color: "var(--rust)", background: "#F4E7E2", borderRadius: 8, padding: 8 }}>
              <AlertTriangle size={13} style={{ verticalAlign: -2 }} /> الحجز ده عليه {fmt(originalBooking?.amountPaid ?? form.amountPaid)} {form.currency} متحصّل - بعد الإلغاء هيتفتح طلب رد فلوس ليك في قائمة الحجوزات: تقدر ترد الفلوس (بتتشال من التحصيل واليومية والتقرير) أو ترفض الرد وتسيبها متحصّلة. الحجز نفسه بيفضل ظاهر في القائمة كحجز ملغي.
            </div>
          )}

          {conflict && duplicatePlan?.ok && (
            <div data-testid="duplicate-plan" style={{ marginTop: 10, fontSize: 12.5, background: "#E8F0F0", color: "var(--teal)", borderRadius: 8, padding: 10 }}>
              <div style={{ fontWeight: 800, marginBottom: 4 }}>الغرفة دي عليها نزيل دلوقتي ({clashesNow.map(clashLabel).join(" / ")})</div>
              لو كمّلت: {duplicatePlan.actions.map((act) => `${act.clash.guestName} هيتسجّل "غادر مبكرًا"${act.action === "trim" ? ` وخروجه يتقصّر لـ ${act.checkout}` : " (دخل وخرج في نفس اليوم)"} - بيتحاسب على الليالي اللي قعدها (الحد الأدنى ليلة)${(Number(act.clash.amountPaid) || 0) > 0 ? " والزيادة المدفوعة تتحوّل لطلب رد فلوس" : ""}`).join(" · ")}، والنزيل الجديد يتسكّن مكانه.
            </div>
          )}
          {conflict && duplicatePlan && !duplicatePlan.ok && (
            <div data-testid="duplicate-blocked" style={{ marginTop: 10, color: "var(--rust)", fontSize: 12.5, background: "#F4E7E2", borderRadius: 8, padding: 10 }}>
              <AlertTriangle size={13} style={{ verticalAlign: -2 }} /> {duplicateBlockedText(duplicatePlan)}
            </div>
          )}

          {form.paymentDetails.onlinePaid ? (
            <div className="cx-card" style={{ marginTop: 10, padding: 10 }}>
              <div style={{ fontSize: 11, color: "var(--muted)" }}>الإجمالي الكلي (غرفة + رسوم)</div>
              <div style={{ fontWeight: 800, fontSize: 15, padding: "4px 0" }}>{fmt(grandTotal)} {form.currency}</div>
              <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 4 }}>الحجز مدفوع أونلاين - سعر الغرفة اتدفع للمنصة. أي خدمات إضافية أو رسم دخول مبكر بتتحصّل في الفندق من بلوك الغرفة وبتدخل اليومية والتقرير.</div>
            </div>
          ) : (
            <div className="cx-card" data-testid="payment-block" style={{ marginTop: 10, padding: 10 }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 8 }}>
                <div><label style={{ fontSize: 11, color: "var(--muted)" }}>الإجمالي الكلي (غرفة + رسوم)</label><div style={{ fontWeight: 800, fontSize: 15, padding: "6px 0" }}>{fmt(grandTotal)} {form.currency}</div></div>
                {isExistingBooking && <div><label style={{ fontSize: 11, color: "var(--muted)" }}>المدفوع حتى الآن</label><div style={{ fontWeight: 800, fontSize: 15, padding: "6px 0" }}>{fmt(paidBefore)} {form.currency}</div></div>}
                <div><label style={{ fontSize: 11, color: "var(--muted)" }}>المتبقي على النزيل</label><div data-testid="balance-due" style={{ fontWeight: 800, fontSize: 15, padding: "6px 0", color: balanceDue > 0 ? "var(--rust)" : "var(--sage)" }}>{fmt(balanceDue)} {form.currency}</div></div>
              </div>
              {!isExistingBooking && !collectionLocked && (
                <div data-testid="advance-payment" style={{ marginTop: 8, paddingTop: 8, borderTop: "1px dashed var(--hair)" }}>
                  <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>المدفوع حتى الآن (اختياري) - بيتسجّل في اليومية بوسيلته وتفاصيله</div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 8, alignItems: "start" }}>
                    <div><label style={{ fontSize: 11, color: "var(--muted)" }}>المبلغ المدفوع ({form.currency})</label><input className="cx-input" data-testid="advance-amount" type="number" min="0" value={form.payNow?.amount ?? ""} onChange={(e) => setForm({ ...form, payNow: { ...form.payNow, amount: e.target.value } })} /></div>
                    <div><label style={{ fontSize: 11, color: "var(--muted)" }}>طريقة الدفع</label><select className="cx-select" data-testid="advance-method" value={form.payNow?.method || "كاش"} onChange={(e) => setForm({ ...form, payNow: { ...form.payNow, method: e.target.value, details: emptyPaymentDetails() } })}>{PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}</select></div>
                    <div><PaymentDetailsInline compact={false} testid="advance" method={form.payNow?.method || "كاش"} details={form.payNow?.details} onChange={(d) => setForm({ ...form, payNow: { ...form.payNow, details: d } })} /></div>
                  </div>
                </div>
              )}
              {collectionLocked && <div style={{ marginTop: 8, fontSize: 11.5, color: "var(--muted)", display: "flex", alignItems: "center", gap: 4 }}><Lock size={11} /> تسجيل التحصيل (كاش / فيزا / تحويل) من صلاحية موظف الشيفت بس - إنت بتحدد سعر الحجز، وحالة الدفع بتتحدّث تلقائيًا أول ما يتحصّل.</div>}
            </div>
          )}


          <details data-testid="form-more" open={!!((Number(form.extras?.tours) || 0) || (Number(form.extras?.pickup) || 0) || form.earlyCheckin?.applied || form.paymentDetails?.onlinePaid || form.notes || (form.source && form.source !== "مباشر") || (form.status && form.status !== "مؤكد"))} style={{ marginTop: 10 }}>
            <summary style={{ cursor: "pointer", fontSize: 12.5, fontWeight: 700, color: "var(--teal)" }}>خيارات إضافية (رسوم، دخول مبكر، حجز أونلاين، جهة الحجز، ملاحظات)</summary>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 8, marginTop: 8 }}>
              <div><label style={{ fontSize: 11, color: "var(--muted)" }}>جهة الحجز</label><select className="cx-select" value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })}>{sourceOptionsFor(form.source).map((s) => <option key={s} value={s}>{s}</option>)}</select></div>
              {perms.editBookings && <div><label style={{ fontSize: 11, color: "var(--muted)" }}>الحالة</label><select className="cx-select" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>{BOOKING_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}</select></div>}
            </div>
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
              <input type="checkbox" disabled={earlyLocked} checked={!!form.earlyCheckin?.applied} onChange={(e) => setForm({ ...form, earlyCheckin: { ...form.earlyCheckin, applied: e.target.checked } })} /> دخول مبكر قبل معاد الحجز الأصلي {earlyLocked && <Lock size={10} />}
            </label>
            {form.earlyCheckin?.applied && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 8 }}>
                <div><label style={{ fontSize: 10.5, color: "var(--muted)" }}>رسم الدخول المبكر</label><input className="cx-input" type="number" min="0" disabled={earlyLocked} value={form.earlyCheckin.fee} onChange={(e) => setForm({ ...form, earlyCheckin: { ...form.earlyCheckin, fee: e.target.value } })} /></div>
                <div style={{ gridColumn: "span 2" }}><label style={{ fontSize: 10.5, color: "var(--muted)" }}>ملاحظة الدخول المبكر</label><AutoText className="cx-input" disabled={earlyLocked} value={form.earlyCheckin.note} onChange={(e) => setForm({ ...form, earlyCheckin: { ...form.earlyCheckin, note: e.target.value } })} /></div>
              </div>
            )}
          </div>

          <div className="cx-card" style={{ marginTop: 10, padding: 10, background: "var(--paper2)" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700 }}>
              <input type="checkbox" disabled={chargeLocked} checked={!!form.paymentDetails.onlinePaid} onChange={(e) => setForm({ ...form, paymentDetails: { ...form.paymentDetails, onlinePaid: e.target.checked } })} /> الحجز مدفوع أونلاين (Booking.com أو أي منصة حجز) {chargeLocked && <Lock size={10} style={{ verticalAlign: -1 }} />}
            </label>
            {form.paymentDetails.onlinePaid && (
              <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 8 }}>
                <div><label style={{ fontSize: 10.5, color: "var(--muted)" }}>إجمالي الحجز الأونلاين</label><div style={{ fontWeight: 700, padding: "6px 0" }}>{fmt(grandTotal)} {form.currency}</div></div>
                {/* الحجز ده مدفوع من خلال منصة حجز (زي Booking.com) مش تحويل
                    مباشر من النزيل - فمفيش "اسم مرسل" أو "رقم محفظة" أصلًا.
                    اسم المنصة نفسها متسجل في "جهة الحجز" فوق، وده بس ملاحظة/
                    كود تأكيد اختياري يخص حجز المنصة. */}
                <div style={{ gridColumn: "1 / -1" }}><label style={{ fontSize: 10.5, color: "var(--muted)" }}>رقم تأكيد الحجز على المنصة / ملاحظة (اختياري)</label><AutoText className="cx-input" placeholder="مثلاً: رقم حجز Booking.com" disabled={chargeLocked} value={form.paymentDetails.ref} onChange={(e) => setForm({ ...form, paymentDetails: { ...form.paymentDetails, ref: e.target.value } })} /></div>
              </div>
            )}
          </div>

            <div style={{ marginTop: 8 }}><label style={{ fontSize: 11, color: "var(--muted)" }}>ملاحظات</label><AutoText className="cx-input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
          </details>

          <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
            <button className="cx-btn cx-btn-gold" onClick={saveBooking}><Check size={14} /> {conflict && duplicatePlan?.ok ? "حفظ الحجز + خروج مبكر للنزيل القديم" : "حفظ الحجز"}</button>
            <button className="cx-btn cx-btn-outline" onClick={() => setForm(null)}>إلغاء</button>
          </div>
        </div>
      )}

      <GuestCodeHits hits={codeHits} rooms={rooms} />
      <div className="cx-no-print" style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
        {[["all", "الكل"], ["active", "الحجوزات الشغّالة"], ["cancelled", "الحجوزات الملغية"]].map(([k, label]) => (
          <button key={k} data-testid={"status-filter-" + k} className={"cx-btn " + (statusFilter === k ? "cx-btn-gold" : "cx-btn-outline")} style={{ fontSize: 12, padding: "5px 12px" }} onClick={() => setStatusFilter(k)}>{label} ({counts[k]})</button>
        ))}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {list.length === 0 && <div style={{ color: "var(--muted)", fontSize: 13, padding: 20, textAlign: "center" }}>لا يوجد حجوزات مطابقة</div>}
        {list.map((b) => { const cancelled = b.status === "ملغي"; return (
          <div key={b.id} data-testid={cancelled ? "booking-cancelled" : "booking-card"} className="cx-card" style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8, ...(cancelled ? { background: "#FBF3F1", borderRightColor: "var(--rust)", borderRightWidth: 4 } : {}) }}>
            <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
              <div>
                <div style={{ fontWeight: 800 }}>
                  <span style={cancelled ? { textDecoration: "line-through", opacity: 0.7 } : undefined}>{roomLabel(rooms, b.room)} · {b.guestName}</span>
                  {cancelled && <span className="cx-pill" style={{ background: "var(--rust)", color: "#fff", marginInlineStart: 6 }}>حجز ملغي</span>}
                  {b.paymentDetails?.onlinePaid && <span className="cx-pill" style={{ background: "#EDE8F5", color: "#7A5FB5", marginInlineStart: 6 }}>مدفوع أونلاين</span>}
                  {b.leftEarly && <span className="cx-pill" style={{ background: "#FBE9DA", color: "var(--rust)", marginInlineStart: 6 }}>غادر مبكرًا</span>}
                  {b.duplicatePlacement && <span className="cx-pill" style={{ background: "#EDE8F5", color: "#6B4FA0", marginInlineStart: 6 }}>تسكين مكرر</span>}
                  {b.code && <span dir="ltr" data-testid="booking-code-chip" style={{ fontFamily: "monospace", fontSize: 11.5, color: "var(--muted)", marginInlineStart: 8 }}>{b.code}</span>}
                </div>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>{b.checkin} → {b.checkout} · {nightsBetween(b.checkin, b.checkout)} ليلة · {b.pax} فرد{b.paymentDetails?.onlinePaid ? "" : ` · ${b.paymentMethod}`} · {b.source}</div>
                <GuestCodeChips codes={guestCodeEntries(b)} />
              </div>
              <div className="cx-no-print" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {b.status === "تم تسجيل الخروج" && <span className="cx-pill" style={{ background: "#00000010", color: "var(--teal)" }}>{b.status}</span>}
                {perms.markPaymentReceived && !cancelled && bookingAmountDue(b) > 0 && <QuickPay booking={b} onDone={onRefresh} showToast={showToast} />}
                {perms.editBookings && (<>
                  <button className="cx-btn cx-btn-outline" title="تعديل" onClick={() => startEdit(b)}><Pencil size={13} /></button>
                  {b.status !== "ملغي" && b.status !== "تم تسجيل الخروج" && (
                    <span data-testid="cancel-booking"><TwoStepButton label="إلغاء الحجز" confirmLabel={`تأكيد الإلغاء؟ ${(Number(b.amountPaid) || 0) > 0 ? `(عليه ${fmt(b.amountPaid)} ${b.currency} متحصّل - هيتفتح طلب رد فلوس لمدير الحجوزات)` : "(مفيش فلوس متحصّلة - مفيش رد)"}`} icon={<Ban size={13} />} onConfirm={() => cancelBooking(b)} /></span>
                  )}
                </>)}
              </div>
              <div className="cx-print-only">
                <span className="cx-pill" style={{ background: "#00000010", color: cancelled ? "var(--rust)" : "var(--teal)" }}>{b.status}</span>
              </div>
            </div>
            <MoneyBox b={b} />
            <PayBreakdown payments={payIndex?.get(b.id)} currency={b.currency} />
            <RefundBox b={b} canDecide={!!perms.decideRefund} onDecide={onDecideRefund} />
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
