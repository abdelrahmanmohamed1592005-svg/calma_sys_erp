import React, { useState, useEffect, useMemo, useRef } from "react";
import { Pencil, Check, X, Eye, AlertTriangle } from "lucide-react";
import { fmt, money, emptyMoney, currencyKeysOf, computeShiftTotals, bookingGrandTotal, bookingHotelTotal, bookingAmountDue, refundDueAmount, refundStatusOf, ONLINE_METHODS, PAYMENT_METHODS, methodOptionsFor } from "../domain/money";
import { todayStr, shiftDayNow, nightsBetween, addDays, uid } from "../domain/dates";
import { SHIFTS, STATUS_COLORS, MANUAL_STATUS_OPTIONS, roomLabel } from "../domain/constants";
import { computeRoomStatus, roomsOverlap, findOverlappingBooking, repricedTotalRoom, earlyLeavePatch, normalizeGuestCodes, duplicateGuestCode, findGuestCodeHits, guestCodeEntries } from "../domain/bookingLogic";
import { getShiftRecord, appendBookingCollection } from "../data/shifts";
import { useShiftGate } from "../hooks/useShiftGate";
import { GuestCodeChips, GuestCodeHits, TwoStepButton, MoneyBox, RefundBox } from "./shared";
import { sanitizeText } from "../domain/security";
import { withBusy } from "../lib/busy";

const STATUS_TINTS = { available: "#E6F2EA", occupied_paid: "#F5EFD6", occupied_unpaid: "#FBE2E4", reserved: "#EDE7F5", early_checkout: "#FBE9DA", maintenance: "#EEEBE7", cleaning: "#E3EBF0" };

/* قسم مطوي في بطاقة الغرفة (برّه الـ component عشان الحقول اللي جواه ماتتفقدش الفوكس وقت الكتابة) */
function Sec({ id, title, children, badge }) {
  return (
    <details data-testid={id} style={{ marginTop: 8, background: "#fff", borderRadius: 8, padding: "6px 10px" }}>
      <summary style={{ cursor: "pointer", fontSize: 12.5, fontWeight: 700 }}>{title}{badge ? <span className="cx-pill" style={{ background: "var(--paper2)", marginInlineStart: 6, fontSize: 10.5 }}>{badge}</span> : null}</summary>
      <div style={{ marginTop: 8 }}>{children}</div>
    </details>
  );
}

export function RoomBoard({ rooms, overrides, bookings, perms, profile, onSaveOverride, onToggleSettled, onUpdateBooking, onEditBooking, onDecideRefund, onLog, showToast, dataVersion }) {
  const [selected, setSelected] = useState(null);
  const [kpis, setKpis] = useState(null);
  const [extrasDraft, setExtrasDraft] = useState(null);
  const extrasBaseRef = useRef("");
  const normExtras = (e) => JSON.stringify([Number(e?.laundry) || 0, Number(e?.cafeteria) || 0, Number(e?.tours) || 0, Number(e?.pickup) || 0]);
  const [collectMethod, setCollectMethod] = useState("كاش");
  const [codeQuery, setCodeQuery] = useState("");
  const [extendNights, setExtendNights] = useState(1);
  const [ecFee, setEcFee] = useState("");
  const [ecNote, setEcNote] = useState("");
  const [ecCollect, setEcCollect] = useState(true);
  const [codesDraft, setCodesDraft] = useState([]);
  const date = todayStr();
  const room = rooms.find((r) => r.number === selected);
  const status = selected ? computeRoomStatus(selected, bookings, overrides, date) : null;

  useEffect(() => { if (status?.booking) setExtrasDraft({ laundry: status.booking.extras?.laundry || "", cafeteria: status.booking.extras?.cafeteria || "", tours: status.booking.extras?.tours || "", pickup: status.booking.extras?.pickup || "" }); else setExtrasDraft(null); if (status?.booking) extrasBaseRef.current = normExtras(status.booking.extras); }, [selected, status?.booking?.id]);
  useEffect(() => { if (status?.booking) setCollectMethod(status.booking.paymentMethod || "كاش"); }, [selected, status?.booking?.id]);
  useEffect(() => { setExtendNights(1); setEcFee(""); setEcNote(""); setEcCollect(true); }, [selected, status?.booking?.id]);
  useEffect(() => { if (status?.booking) setCodesDraft(normalizeGuestCodes(status.booking.guestCodes, status.booking.pax)); else setCodesDraft([]); }, [selected, status?.booking?.id, status?.booking?.pax, JSON.stringify(status?.booking?.guestCodes || [])]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let rev = emptyMoney(), exp = emptyMoney(), flagged = 0;
      for (const s of SHIFTS) {
        const r = await getShiftRecord(shiftDayNow(), s.key);
        if (cancelled) return;
        if (!r) continue;
        const t = computeShiftTotals(r);
        currencyKeysOf(t.totalCollections).forEach((c) => { rev[c] = (rev[c] || 0) + t.totalCollections[c]; });
        currencyKeysOf(t.totalExpenses).forEach((c) => { exp[c] = (exp[c] || 0) + t.totalExpenses[c]; });
        if (r.flagged) flagged += 1;
      }
      if (!cancelled) setKpis({ rev, exp, flagged });
    })();
    return () => { cancelled = true; };
  }, [date, dataVersion]);

  // موظف الشيفت (staff) يقدر يغيّر حالة الغرف ويحصّل الفلوس بس وهو في شيفته
  // الفعلي اللي حاجزه ولسه مفتوح (مش مقفول) - عشان نمنع موظف يدخل بره معاده
  // أو بعد ما يكون قفل شيفته يعدل على حاجة مش شغله. الهوك ده نفسه بالظبط
  // المستخدم في BookingsPanel.jsx عشان الاتنين يتفقوا على نفس القرار بدون
  // أي تضارب. باقي الأدوار (مدير الحجوزات/الحسابات/المدير العام) مش مربوطة
  // بشيفت أصلًا (roomStatusRestricted: false) فمش بيأثر عليهم.
  const { offShift, shiftClosed, myActiveShiftKey, myActiveShiftDate } = useShiftGate(profile, perms, dataVersion);


  async function saveOverride(statusKey) {
    if (offShift) { showToast(shiftClosed ? "شيفتك مقفول - لازم المدير العام أو مدير الحجوزات يفتحوه تاني الأول" : "مش شيفتك دلوقتي - الحالة مش هتتعدل غير وقت شيفتك اللي حاجزه"); return; }
    const res = await onSaveOverride(selected, statusKey);
    if (res?.error) { showToast(res.error); return; }
    onLog(`تغيير حالة ${roomLabel(rooms, selected)} إلى: ${MANUAL_STATUS_OPTIONS.find((o) => o.key === statusKey)?.label}`);
    showToast("تم تحديث حالة الغرفة");
  }
  // تسجيل تحصيل كامل المبلغ لازم يسجل طريقة الدفع الفعلية (فيزا/تحويل بنكي/
  // فودافون كاش...) مش بس يعلّم "متحصّل" - عشان التقرير يقدر يحسب كل طريقة
  // دفع صح، فبنحدّث amountPaid وطريقة الدفع مع علامة التحصيل في تحديث واحد.
  // بعد كده الإجمالي/الرسوم الإضافية بقت مقفولة (قاعدة البيانات نفسها بترفض
  // أي تعديل عليها - انظر قسم ١٧ في schema.sql) لحد ما حد يلغي علامة التحصيل
  // دي الأول - عشان "خلاص اتحصّل" يفضل معناها خلاص فعليًا، مش حاجة ممكن
  // تتغيّر من تحتها وتبوّظ المبلغ اللي فعليًا استلمناه.
  async function collectFullPayment(booking) { return withBusy(() => collectFullPaymentInner(booking)); }
  async function collectFullPaymentInner(booking) {
    // حجز أونلاين: سعر الغرفة اتدفع للمنصة، فالفندق بيحصّل بس الخدمات/الدخول المبكر
    const online = !!booking.paymentDetails?.onlinePaid;
    const gt = bookingHotelTotal(booking);
    const res = await onUpdateBooking(booking.id, { ...booking, paymentMethod: collectMethod, amountPaid: gt, settled: online ? booking.settled : true });
    if (res?.error) { showToast(res.error); return; }
    onLog(`تحصيل كامل مبلغ الحجز (${collectMethod}) - ${roomLabel(rooms, booking.room)} - ${booking.guestName}`);
    // سجّل المبلغ المتحصّل فعليًا دلوقتي (المتبقي اللي كان على النزيل) تلقائيًا
    // في يومية شيفت موظف الشيفت النهارده - انظر appendBookingCollection في
    // data/shifts.js. من غيرها كان التحصيل (خصوصًا الكاش) ممكن ميظهرش في
    // رصيد الدرج أو "تحصيل اليوم" فوق إلا لو الموظف دخّله يدويًا تاني في
    // اليومية.
    const paidDelta = gt - (Number(booking.amountPaid) || 0);
    let ledgerWarning = "";
    if (paidDelta !== 0 && myActiveShiftKey) {
      const ledgerRes = await appendBookingCollection(myActiveShiftDate || shiftDayNow(), myActiveShiftKey, profile, rooms, {
        id: uid(), bookingId: booking.id, room: booking.room, guestName: booking.guestName,
        amount: paidDelta, currency: booking.currency, method: collectMethod,
        note: "تحصيل كامل مبلغ الحجز", at: Date.now(),
      });
      if (ledgerRes?.error) ledgerWarning = " — لكن تعذر تسجيله تلقائيًا في اليومية، سجّليه يدويًا: " + ledgerRes.error;
    }
    showToast((online ? "تم تسجيل تحصيل الخدمات/الدخول المبكر" : "تم تسجيل التحصيل الكامل - السعر والرسوم الإضافية مقفولة دلوقتي، لو احتجتي تعدّليهم لازم تلغي التحصيل الأول") + ledgerWarning);
  }
  // الحجز مدفوع فعلًا بالكامل (المدفوع >= الإجمالي) لكن علامة "متحصّل" اتشالت
  // (مثلاً بعد إلغاء التحصيل لتعديل الرسوم) - بنرجّعها من غير أي مبلغ جديد.
  async function markSettled(booking) { return withBusy(() => markSettledInner(booking)); }
  async function markSettledInner(booking) {
    const res = await onToggleSettled(booking, true);
    if (res?.error) { showToast(res.error); return; }
    onLog(`تعليم الحجز متحصّل بالكامل - ${roomLabel(rooms, booking.room)} - ${booking.guestName}`);
    showToast("تم تعليم الحجز متحصّل بالكامل");
  }
  async function undoSettled(booking) { return withBusy(() => undoSettledInner(booking)); }
  async function undoSettledInner(booking) {
    const res = await onToggleSettled(booking, false);
    if (res?.error) { showToast(res.error); return; }
    onLog(`إلغاء تحصيل كامل مبلغ الحجز - ${roomLabel(rooms, booking.room)} - ${booking.guestName}`);
    showToast("تم إلغاء علامة التحصيل - السعر والرسوم بقت قابلة للتعديل تاني");
  }
  // دخول مبكر: رسم بيتضاف على الحجز (بيزوّد الإجمالي)، وممكن يتحصّل في نفس اللحظة فيدخل اليومية والتقرير والتوتال.
  async function applyEarlyCheckin(booking) { return withBusy(() => applyEarlyCheckinInner(booking)); }
  async function applyEarlyCheckinInner(booking) {
    if (offShift) { showToast(shiftClosed ? "شيفتك مقفول - لازم يُفتح تاني الأول" : "مش شيفتك دلوقتي"); return; }
    const fee = Math.max(0, Math.round((Number(ecFee) || 0) * 100) / 100);
    if (!(fee > 0)) { showToast("اكتب رسم الدخول المبكر (أكبر من صفر)"); return; }
    const collectNow = !!perms.markPaymentReceived && ecCollect;
    const next = { ...booking, earlyCheckin: { applied: true, fee, note: sanitizeText(ecNote, 300) }, settled: false };
    if (collectNow) { next.amountPaid = (Number(booking.amountPaid) || 0) + fee; next.paymentMethod = collectMethod; }
    const res = await onUpdateBooking(booking.id, next);
    if (res?.error) { showToast(res.error); return; }
    let saved = res?.data || next;
    onLog(`دخول مبكر ${fee} ${booking.currency} - ${roomLabel(rooms, booking.room)} - ${booking.guestName}${collectNow ? ` (اتحصّل - ${collectMethod})` : " (لسه ماتحصّلش)"}`);
    let warn = "";
    if (collectNow) {
      if (myActiveShiftKey) {
        const ledgerRes = await appendBookingCollection(myActiveShiftDate || shiftDayNow(), myActiveShiftKey, profile, rooms, {
          id: uid(), bookingId: booking.id, room: booking.room, guestName: booking.guestName,
          amount: fee, currency: booking.currency, method: collectMethod, note: "رسم دخول مبكر", at: Date.now(),
        });
        if (ledgerRes?.error) warn = " — لكن تعذر تسجيله تلقائيًا في اليومية، سجّليه يدويًا: " + ledgerRes.error;
      } else warn = " — ⚠ مفيش شيفتك شغال فالمبلغ ماتسجّلش في اليومية تلقائيًا";
      // الحجز كان متحصّل بالكامل قبل الرسم ورجع متحصّل بعد التحصيل: نرجّع العلامة
      if (booking.settled && !booking.paymentDetails?.onlinePaid && bookingAmountDue(saved) <= 0) {
        const r2 = await onToggleSettled(saved, true);
        if (r2?.error) warn += " — تعذر إرجاع علامة \"متحصّل بالكامل\": " + r2.error;
      }
    }
    setEcFee(""); setEcNote("");
    showToast(`تم تسجيل الدخول المبكر (${fmt(fee)} ${booking.currency})${collectNow ? " واتحصّل" : " - لسه متبقي على النزيل، حصّله من زرار التحصيل"}` + warn);
  }
  // غادر مبكرًا: بيقصّر الإقامة لحد النهارده (الحد الأدنى ليلة)، والزيادة اللي كان النزيل دافعها عن ليالي
  // ماقعدهاش بتتحوّل لطلب رد فلوس لمدير الحجوزات (قاعدة البيانات هي اللي بتفتحه).
  async function earlyLeave(booking) { return withBusy(() => earlyLeaveInner(booking)); }
  async function earlyLeaveInner(booking) {
    if (offShift) { showToast(shiftClosed ? "شيفتك مقفول - لازم يُفتح تاني الأول" : "مش شيفتك دلوقتي"); return; }
    const patch = earlyLeavePatch(booking, date, "plain");
    const res = await onUpdateBooking(booking.id, { ...booking, ...patch });
    if (res?.error) { showToast(res.error); return; }
    const saved = res?.data || { ...booking, ...patch };
    const stayed = Math.max(1, nightsBetween(booking.checkin, date));
    const plannedNights = nightsBetween(booking.checkin, booking.checkout);
    onLog(`غادر مبكرًا - ${roomLabel(rooms, booking.room)} - ${booking.guestName} - قعد ${stayed} من ${plannedNights} ليلة`);
    const owed = refundDueAmount(saved);
    const left = bookingAmountDue(saved);
    let msg = `النزيل غادر مبكرًا: اتحاسب على ${stayed} ليلة من ${plannedNights} (الحد الأدنى ليلة) - الإجمالي بقى ${fmt(bookingGrandTotal(saved))} ${booking.currency}`;
    if (owed > 0) msg += ` — ${fmt(owed)} ${booking.currency} زيادة مدفوعة اتبعتت كطلب رد فلوس لمدير الحجوزات`;
    else if ((Number(saved.amountPaid) || 0) > 0 && left <= 0) msg += " — مفيش رد: المدفوع مايزيدش عن الإقامة الفعلية";
    if (left > 0) msg += ` — لسه متبقي على النزيل ${fmt(left)} ${booking.currency}`;
    showToast(msg);
  }
  // معاينة قبل التأكيد: هيتحاسب على كام ليلة وهل في رد فلوس هيتفتح
  function earlyLeavePreview(booking) {
    const patch = earlyLeavePatch(booking, date, "plain");
    const next = { ...booking, totalRoom: patch.totalRoom };
    const stayed = Math.max(1, nightsBetween(booking.checkin, date));
    const owed = Math.max(0, (Number(booking.amountPaid) || 0) - bookingGrandTotal(next));
    const left = bookingAmountDue(next);
    return `(هيتحاسب ${stayed} ليلة من ${nightsBetween(booking.checkin, booking.checkout)}${owed > 0 ? ` - طلب رد ${fmt(owed)} ${booking.currency} لمدير الحجوزات` : left > 0 ? ` - متبقي ${fmt(left)} ${booking.currency}` : " - مفيش رد"})`;
  }
  async function saveGuestCodes(booking) { return withBusy(() => saveGuestCodesInner(booking)); }
  async function saveGuestCodesInner(booking) {
    const codes = normalizeGuestCodes(codesDraft.map((c) => sanitizeText(c, 40)), booking.pax);
    const dup = duplicateGuestCode(codes);
    if (dup) { showToast(`الكود ${dup} مكتوب لأكتر من فرد في نفس الحجز - كل فرد ليه كود مختلف`); return; }
    const res = await onUpdateBooking(booking.id, { ...booking, guestCodes: codes });
    if (res?.error) { showToast(res.error); return; }
    onLog(`تعديل أكواد الأفراد - ${roomLabel(rooms, booking.room)} - ${booking.guestName}`);
    showToast("تم حفظ أكواد الأفراد");
  }
  // تمديد الحجز بليلة/ليالي إضافية: بتحرك تاريخ الخروج قدام، وبتزود إجمالي
  // سعر الغرفة بقيمة الليالي الجديدة على نفس سعر الليلة المتفق عليه
  // (من غير ما تلمس أي رسوم إضافية أو مدفوعات سابقة)، فكل حاجة تبعها -
  // الإجمالي الكلي، المتبقي، التقارير - بتتحدث تلقائي لوحدها. وبتتأكد الأول
  // إن الغرفة مش متحجزة لحد تاني في الليالي الإضافية دي قبل ما تأكد - لو فيه
  // تعارض وكان هو حجز أضافه مدير الحجوزات، بنوضح ده صريح في رسالة الرفض.
  async function extendBooking(booking) { return withBusy(() => extendBookingInner(booking)); }
  async function extendBookingInner(booking) {
    if (offShift) { showToast(shiftClosed ? "شيفتك مقفول - لازم يُفتح تاني الأول" : "مش شيفتك دلوقتي"); return; }
    const n = Math.max(1, Number(extendNights) || 1);
    const newCheckout = addDays(booking.checkout, n);
    const conflict = roomsOverlap(bookings, booking.room, booking.checkout, newCheckout, booking.id);
    if (conflict) {
      const clash = findOverlappingBooking(bookings, booking.room, booking.checkout, newCheckout, booking.id);
      if (clash?.createdByRole === "reservations") { showToast("مينفعش تمدد - مدير الحجوزات ضايف حجز على الغرفة دي في التاريخ ده"); return; }
      showToast("الغرفة محجوزة لحد تاني في الليلة/الليالي الجديدة - مينفعش تمدد بالتاريخ ده");
      return;
    }
    const newTotalRoom = repricedTotalRoom(booking, booking.checkin, newCheckout);
    const extended = { ...booking, checkout: newCheckout, totalRoom: newTotalRoom };
    // الليالي الإضافية ليها سعر (سعر الليلة المتفق عليه) ولسه ماتحصّلتش - فلو
    // الحجز كان "متحصّل بالكامل" وبقى عليه متبقي، العلامة بتتشال تلقائيًا
    // والغرفة تبقى حمراء لحد ما يتحصّل الفرق (مش لازم حد يلغي التحصيل بإيده).
    const gtNew = bookingGrandTotal(extended);
    const paidNow = Number(booking.amountPaid) || 0;
    const reopensBalance = !booking.paymentDetails?.onlinePaid && booking.settled && gtNew > paidNow;
    const res = await onUpdateBooking(booking.id, { ...extended, settled: reopensBalance ? false : booking.settled });
    if (res?.error) { showToast(res.error); return; }
    onLog(`تمديد حجز ${roomLabel(rooms, booking.room)} - ${booking.guestName} بـ${n} ليلة/ليالي - تشيك أوت جديد ${newCheckout}`);
    const due = booking.paymentDetails?.onlinePaid ? 0 : Math.max(0, gtNew - paidNow);
    showToast(`تم تمديد الحجز لحد ${newCheckout}${due > 0 ? ` - الإجمالي بقى ${fmt(gtNew)} ${booking.currency} والمتبقي ${fmt(due)} (الغرفة حمراء لحد التحصيل)` : ""}`);
    setExtendNights(1);
  }
  async function saveExtras(booking) { return withBusy(() => saveExtrasInner(booking)); }
  async function saveExtrasInner(booking) {
    if (offShift) { showToast(shiftClosed ? "شيفتك مقفول - لازم يُفتح تاني الأول" : "مش شيفتك دلوقتي"); return; }
    // منع أي قيمة سالبة من غير داعي تضرب قيد قاعدة البيانات (bookings_extras_nonneg)
    // وتطلّع رسالة خطأ تقنية مش مفهومة للموظف - بنمنعها من هنا الأول.
    // الرسوم اتغيّرت من جهاز تاني وانت بتعدّل: نحدّث المسودة ونطلب مراجعة بدل
    // ما نكتب فوق التعديل الأحدث من غير ما حد يدري.
    if (normExtras(booking.extras) !== extrasBaseRef.current) {
      const e = booking.extras || {};
      setExtrasDraft({ laundry: e.laundry || "", cafeteria: e.cafeteria || "", tours: e.tours || "", pickup: e.pickup || "" });
      extrasBaseRef.current = normExtras(e);
      showToast("الرسوم الإضافية اتعدّلت من مكان تاني - راجع القيم الجديدة واضغط حفظ تاني");
      return;
    }
    const clamped = { laundry: Math.max(0, Number(extrasDraft.laundry) || 0), cafeteria: Math.max(0, Number(extrasDraft.cafeteria) || 0), tours: Math.max(0, Number(extrasDraft.tours) || 0), pickup: Math.max(0, Number(extrasDraft.pickup) || 0) };
    const res = await onUpdateBooking(booking.id, { ...booking, extras: clamped });
    if (res?.error) { showToast(res.error); return; }
    setExtrasDraft(clamped); extrasBaseRef.current = normExtras(clamped);
    onLog(`تعديل الرسوم الإضافية - ${roomLabel(rooms, booking.room)} - ${booking.guestName}`);
    showToast("تم حفظ الرسوم الإضافية");
  }

  const counts = useMemo(() => { const c = { available: 0, occupied_paid: 0, occupied_unpaid: 0, reserved: 0, maintenance: 0, cleaning: 0, early_checkout: 0 }; rooms.forEach((r) => { const s = computeRoomStatus(r.number, bookings, overrides, date); c[s.key] = (c[s.key] || 0) + 1; }); return c; }, [rooms, bookings, overrides, date]);
  const revCurrencies = kpis ? currencyKeysOf(kpis.rev, kpis.exp) : [];
  // بحث بكود النزيل: بيرجّع الغرفة اللي كان ساكن فيها
  const cq = codeQuery.trim().toLowerCase();
  const codeHits = findGuestCodeHits(bookings, cq);

  return (
    <div style={{ padding: 14 }}>
      <div className="cx-no-print" style={{ marginBottom: 12 }}>
        <input className="cx-input" data-testid="board-code-search" style={{ maxWidth: 320 }} placeholder="🔎 بحث بكود النزيل (يعرّفك الغرفة)" value={codeQuery} onChange={(e) => setCodeQuery(e.target.value)} />
        <div style={{ marginTop: 8 }}><GuestCodeHits hits={codeHits} rooms={rooms} onOpenRoom={(r) => { setSelected(r); setCodeQuery(""); }} /></div>
        {cq.length >= 3 && !codeHits.length && <div data-testid="board-code-missing" style={{ marginTop: 6, fontSize: 12, color: "var(--rust)" }}>مفيش نزيل بالكود ده</div>}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10, marginBottom: 14 }}>
        <div className="cx-kpi"><div style={{ fontSize: 11, color: "var(--muted)" }}>تحصيل اليوم</div><div style={{ fontWeight: 800, fontSize: 15 }}>{kpis ? (revCurrencies.length ? revCurrencies.map((c) => `${money(kpis.rev, c)} ${c}`).join(" + ") : "0") : "…"}</div></div>
        <div className="cx-kpi"><div style={{ fontSize: 11, color: "var(--muted)" }}>مصاريف اليوم</div><div style={{ fontWeight: 800, fontSize: 15 }}>{kpis ? (revCurrencies.length ? revCurrencies.map((c) => `${money(kpis.exp, c)} ${c}`).join(" + ") : "0") : "…"}</div></div>
        <div className="cx-kpi"><div style={{ fontSize: 11, color: "var(--muted)" }}>نسبة الإشغال</div><div style={{ fontWeight: 800, fontSize: 20 }}>{rooms.length ? Math.round((((counts.occupied_paid || 0) + (counts.occupied_unpaid || 0)) / rooms.length) * 100) : 0}%</div></div>
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
            <div style={{ fontWeight: 800, fontSize: r.name ? 14.5 : 20, lineHeight: 1.15, wordBreak: "break-word" }}>{r.name || r.number}</div>
            {s.guest && <div style={{ fontSize: 12, fontWeight: 700, marginTop: 4 }}>{s.guest}</div>}
            {s.booking && <div data-testid={"tile-price-" + r.number} style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{fmt(s.booking.priceNight)} {s.booking.currency} / ليلة</div>}
            {s.booking?.duplicatePlacement && <span className="cx-pill" style={{ background: "#EDE8F5", color: "#6B4FA0", fontSize: 10, marginTop: 3 }}>تسكين مكرر</span>}
          </div>
        ); })}
      </div>

      {room && status && (() => {
        const b = status.booking;
        const departedList = bookings.filter((bk) => bk.room === selected && bk.leftEarly && bk.status !== "ملغي" && (bk.checkout === date || bk.checkin === date) && bk.id !== b?.id);
        const occupiedNow = status.key === "occupied_paid" || status.key === "occupied_unpaid";
        const canAct = (perms.editBookings || perms.markPaymentReceived) && !offShift;
        const online = !!b?.paymentDetails?.onlinePaid;
        const due = b ? bookingAmountDue(b) : 0;
        const extrasList = b ? [
          b.extras?.laundry > 0 && ["غسيل", b.extras.laundry],
          b.extras?.cafeteria > 0 && ["كافيتيريا", b.extras.cafeteria],
          b.extras?.tours > 0 && ["جولات", b.extras.tours],
          b.extras?.pickup > 0 && ["بيك أب", b.extras.pickup],
          b.earlyCheckin?.applied && ["دخول مبكر", b.earlyCheckin.fee || 0],
        ].filter(Boolean) : [];
        const codes = b ? guestCodeEntries(b) : [];
        return (
        <div className="cx-card" style={{ marginTop: 16, padding: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div style={{ fontSize: 20, fontWeight: 800 }}>{roomLabel(rooms, room.number)} <span className="cx-pill" style={{ background: STATUS_TINTS[status.key], color: STATUS_COLORS[status.key], fontSize: 11.5, marginInlineStart: 6 }}>{status.label}</span></div>
            <button className="cx-btn cx-btn-outline" onClick={() => setSelected(null)}><X size={14} /></button>
          </div>

          {/* نزيل غادر مبكرًا النهارده: بياناته وحسابه وحالة رد الفلوس بنفس الشكل في كل مكان */}
          {departedList.map((d) => (
            <div key={d.id} data-testid="departed-card" className="cx-card" style={{ marginTop: 10, padding: 10, background: "#FBE9DA", display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ fontSize: 13 }}>
                <span className="cx-pill" style={{ background: "#fff", color: "var(--rust)", fontSize: 11, marginInlineEnd: 6 }}>غادر مبكرًا</span>
                <b>{d.guestName}</b> - غادر النهارده ({d.checkin} → {d.checkout}){d.checkin === d.checkout ? " - دخل وخرج في نفس اليوم" : ""}{bookings.some((bk) => bk.room === selected && bk.duplicatePlacement && bk.id !== d.id && bk.checkin <= date && date < bk.checkout) ? " وحل مكانه نزيل جديد" : ""}
              </div>
              <MoneyBox b={d} />
              <RefundBox b={d} canDecide={!!perms.decideRefund} onDecide={onDecideRefund} />
            </div>
          ))}

          {b && (
            <div className="cx-card" data-testid="booking-card" style={{ marginTop: 10, padding: 12, background: "var(--paper2)", display: "flex", flexDirection: "column", gap: 8 }}>
              <div>
                <div style={{ fontWeight: 800, fontSize: 15 }}>
                  {b.guestName}
                  {online && <span className="cx-pill" style={{ background: "#EDE8F5", color: "#6B4FA0", marginInlineStart: 6, fontSize: 11 }}>مدفوع أونلاين</span>}
                  {b.duplicatePlacement && <span className="cx-pill" style={{ background: "#EDE8F5", color: "#6B4FA0", marginInlineStart: 6, fontSize: 11 }}>تسكين مكرر</span>}
                  {b.settled && <span className="cx-pill" style={{ background: "#EAF2EC", color: "var(--sage)", marginInlineStart: 6, fontSize: 11 }}>متحصّل بالكامل - مقفول</span>}
                </div>
                <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 2 }}>
                  {b.checkin} ← {b.checkout} · {nightsBetween(b.checkin, b.checkout)} ليلة · {fmt(b.priceNight)} {b.currency} / ليلة · {b.pax || 1} فرد
                  {b.code && <span dir="ltr" data-testid="card-booking-code" style={{ fontFamily: "monospace", marginInlineStart: 8 }}>{b.code}</span>}
                </div>
              </div>

              <MoneyBox b={b} />
              <RefundBox b={b} canDecide={!!perms.decideRefund} onDecide={onDecideRefund} />

              {offShift && (perms.markPaymentReceived || perms.editBookings) && <div style={{ fontSize: 11.5, color: "var(--rust)", background: "#F4E7E2", borderRadius: 8, padding: 8, display: "flex", alignItems: "center", gap: 4 }}><AlertTriangle size={12} /> {shiftClosed ? "شيفتك مقفول - لازم المدير العام أو مدير الحجوزات يفتحوه تاني عشان تقدر تعمل أي حاجة هنا." : "مش شيفتك دلوقتي - التحصيل والتعديل مش متاحين غير وقت شيفتك اللي حاجزه."}</div>}

              {/* الأفعال الأساسية: تحصيل / غادر مبكرًا */}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                {perms.markPaymentReceived && !offShift && online && due > 0 && (<>
                  <select className="cx-select" data-testid="collect-method" style={{ fontSize: 12, width: 120 }} value={collectMethod} onChange={(e) => setCollectMethod(e.target.value)}>{methodOptionsFor(collectMethod).map((m) => <option key={m} value={m}>{m}</option>)}</select>
                  <button className="cx-btn cx-btn-gold" data-testid="collect-extras" style={{ fontSize: 12 }} onClick={() => collectFullPayment(b)}><Check size={13} /> تسجيل تحصيل الخدمات/الدخول المبكر</button>
                </>)}
                {perms.markPaymentReceived && !offShift && !online && (
                  b.settled ? (
                    <button className="cx-btn cx-btn-outline" style={{ fontSize: 12 }} onClick={() => undoSettled(b)}>إلغاء علامة "متحصّل بالكامل"</button>
                  ) : due <= 0 ? (
                    <button className="cx-btn cx-btn-gold" style={{ fontSize: 12 }} onClick={() => markSettled(b)}><Check size={13} /> تعليم "متحصّل بالكامل"</button>
                  ) : (<>
                    <select className="cx-select" data-testid="collect-method" style={{ fontSize: 12, width: 120 }} value={collectMethod} onChange={(e) => setCollectMethod(e.target.value)}>{methodOptionsFor(collectMethod).map((m) => <option key={m} value={m}>{m}</option>)}</select>
                    <button className="cx-btn cx-btn-gold" style={{ fontSize: 12 }} onClick={() => collectFullPayment(b)}><Check size={13} /> تسجيل تحصيل كامل المبلغ</button>
                  </>)
                )}
                {occupiedNow && perms.editRoomStatus && !offShift && (
                  <span data-testid="early-leave"><TwoStepButton label="غادر مبكرًا (تقصير الإقامة)" confirmLabel={`تأكيد المغادرة المبكرة؟ ${earlyLeavePreview(b)}`} onConfirm={() => earlyLeave(b)} /></span>
                )}
                {perms.editBookings && onEditBooking && <button className="cx-btn cx-btn-outline" style={{ fontSize: 12 }} onClick={() => onEditBooking(b.id)}><Pencil size={13} /> تعديل الحجز</button>}
              </div>

              {/* باقي التفاصيل مطوية عشان الشاشة تفضل بسيطة */}
              {(extrasList.length > 0 || (canAct && occupiedNow)) && (
                <Sec id="sec-extras" title="خدمات إضافية ودخول مبكر" badge={extrasList.length ? extrasList.length : null}>
                  {extrasDraft && (perms.editBookings || perms.markPaymentReceived) && !offShift && !b.settled ? (
                    <div>
                      <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>رسوم إضافية (بتتضاف على طول من غير ما تفتح الحجز كامل)</div>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(90px,1fr))", gap: 6 }}>
                        {profile?.role !== "reservations" && (<>
                          <div><label style={{ fontSize: 10, color: "var(--muted)" }}>غسيل</label><input className="cx-input" type="number" min="0" value={extrasDraft.laundry} onChange={(e) => setExtrasDraft({ ...extrasDraft, laundry: e.target.value })} /></div>
                          <div><label style={{ fontSize: 10, color: "var(--muted)" }}>كافيتيريا</label><input className="cx-input" type="number" min="0" value={extrasDraft.cafeteria} onChange={(e) => setExtrasDraft({ ...extrasDraft, cafeteria: e.target.value })} /></div>
                        </>)}
                        <div><label style={{ fontSize: 10, color: "var(--muted)" }}>جولات</label><input className="cx-input" type="number" min="0" value={extrasDraft.tours} onChange={(e) => setExtrasDraft({ ...extrasDraft, tours: e.target.value })} /></div>
                        <div><label style={{ fontSize: 10, color: "var(--muted)" }}>بيك أب</label><input className="cx-input" type="number" min="0" value={extrasDraft.pickup} onChange={(e) => setExtrasDraft({ ...extrasDraft, pickup: e.target.value })} /></div>
                      </div>
                      <button className="cx-btn cx-btn-gold" style={{ marginTop: 8, fontSize: 12 }} onClick={() => saveExtras(b)}><Check size={13} /> حفظ الرسوم</button>
                    </div>
                  ) : extrasList.length > 0 && (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{extrasList.map(([label, amt]) => <span key={label} className="cx-pill" style={{ background: "var(--paper2)" }}>{label}: {fmt(amt)}</span>)}{b.settled && canAct && <span style={{ fontSize: 11, color: "var(--muted)" }}>(مقفولة - الحجز متحصّل بالكامل)</span>}</div>
                  )}
                  {b.earlyCheckin?.applied && b.earlyCheckin.note && <div style={{ marginTop: 6, fontSize: 11.5, color: "var(--muted)" }}>ملاحظة الدخول المبكر: {b.earlyCheckin.note}</div>}
                  {occupiedNow && !b.earlyCheckin?.applied && canAct && (
                    <div data-testid="early-checkin-panel" style={{ marginTop: 10, paddingTop: 8, borderTop: "1px solid var(--hair)" }}>
                      <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>النزيل دخل بدري قبل معاد الحجز؟ سجّل رسم الدخول المبكر - بيزوّد إجمالي الحجز{perms.markPaymentReceived ? "، ولو حصّلته دلوقتي بيتسجّل في اليومية والتقرير" : ""}</div>
                      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                        <input className="cx-input" data-testid="early-fee" type="number" min="0" placeholder="الرسم" value={ecFee} onChange={(e) => setEcFee(e.target.value)} style={{ width: 90 }} />
                        <input className="cx-input" data-testid="early-note" placeholder="ملاحظة (اختياري)" value={ecNote} onChange={(e) => setEcNote(e.target.value)} style={{ width: 160 }} />
                        {perms.markPaymentReceived && (<>
                          <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}><input type="checkbox" data-testid="early-collect" checked={ecCollect} onChange={(e) => setEcCollect(e.target.checked)} /> حصّلته دلوقتي</label>
                          {ecCollect && <select className="cx-select" style={{ fontSize: 12, width: 110 }} value={collectMethod} onChange={(e) => setCollectMethod(e.target.value)}>{methodOptionsFor(collectMethod).map((m) => <option key={m} value={m}>{m}</option>)}</select>}
                        </>)}
                        <button className="cx-btn cx-btn-gold" data-testid="early-apply" style={{ fontSize: 12 }} onClick={() => applyEarlyCheckin(b)}><Check size={13} /> تسجيل الدخول المبكر</button>
                      </div>
                    </div>
                  )}
                </Sec>
              )}

              {canAct && occupiedNow && (
                <Sec id="sec-extend" title="تمديد الإقامة">
                  <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>حدد عدد الليالي الإضافية - تاريخ الخروج والإجمالي والمتبقي بيتحدثوا لوحدهم (لو الغرفة محجوزة لحد تاني في التاريخ الجديد مش هيتسمحلك)</div>
                  <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                    <input className="cx-input" type="number" min="1" value={extendNights} onChange={(e) => setExtendNights(e.target.value)} style={{ width: 70 }} />
                    <span style={{ fontSize: 11.5, color: "var(--muted)" }}>ليلة/ليالي إضافية</span>
                    <button className="cx-btn cx-btn-outline" style={{ fontSize: 12 }} onClick={() => extendBooking(b)}>تمديد الحجز</button>
                  </div>
                </Sec>
              )}

              <Sec id="sec-codes" title="أكواد الأفراد" badge={codes.length ? codes.length : null}>
                <GuestCodeChips codes={codes} />
                {canAct && (
                  <div data-testid="guest-codes-editor" style={{ marginTop: 6 }}>
                    <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>كود لكل فرد (اكتبه بنفسك - فريد جوه الشهر)</div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                      {codesDraft.slice(0, 100).map((c, i) => <input key={i} className="cx-input" data-testid={`board-code-input-${i + 1}`} dir="ltr" maxLength={40} placeholder={`كود الفرد ${i + 1}`} value={c} onChange={(e) => setCodesDraft(codesDraft.map((x, j) => (j === i ? e.target.value : x)))} style={{ width: 130 }} />)}
                      <button className="cx-btn cx-btn-outline" data-testid="board-codes-save" style={{ fontSize: 12 }} onClick={() => saveGuestCodes(b)}>حفظ الأكواد</button>
                    </div>
                  </div>
                )}
              </Sec>

              <Sec id="sec-info" title="بيانات الحجز">
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", gap: 8, fontSize: 12.5 }}>
                  <div><div style={{ color: "var(--muted)", fontSize: 10.5 }}>مصدر الحجز</div><div style={{ fontWeight: 700 }}>{b.source}</div></div>
                  {!online && <div><div style={{ color: "var(--muted)", fontSize: 10.5 }}>طريقة الدفع</div><div style={{ fontWeight: 700 }}>{b.paymentMethod}</div></div>}
                  <div><div style={{ color: "var(--muted)", fontSize: 10.5 }}>سعر الليلة × المدة</div><div style={{ fontWeight: 700 }}>{fmt(b.priceNight)} × {nightsBetween(b.checkin, b.checkout)} = {fmt(b.totalRoom)} {b.currency}</div></div>
                  {online && b.paymentDetails?.ref && <div style={{ gridColumn: "1 / -1" }}><div style={{ color: "var(--muted)", fontSize: 10.5 }}>ملاحظة حجز المنصة</div><div style={{ fontWeight: 700 }}>{b.paymentDetails.ref}</div></div>}
                  {!online && ONLINE_METHODS.includes(b.paymentMethod) && b.paymentDetails?.senderName && (
                    <div style={{ gridColumn: "1 / -1" }}><div style={{ color: "var(--muted)", fontSize: 10.5 }}>تفاصيل التحويل المباشر</div><div style={{ fontWeight: 700 }}>{b.paymentDetails.senderName} · {b.paymentDetails.senderNumber} {b.paymentDetails.ref && `· ${b.paymentDetails.ref}`}</div></div>
                  )}
                  {b.notes && <div style={{ gridColumn: "1 / -1" }}><div style={{ color: "var(--muted)", fontSize: 10.5 }}>ملاحظات</div><div>{b.notes}</div></div>}
                </div>
              </Sec>
            </div>
          )}

          {/* الحالة اليدوية: صيانة / تنظيف بس، وبس لما مفيش نزيل ساكن (النزيل الساكن مابيتخباش بأي حالة) */}
          {!perms.editRoomStatus ? (<div style={{ marginTop: 12, fontSize: 12, color: "var(--muted)", display: "flex", alignItems: "center", gap: 4 }}><Eye size={13} /> عرض فقط لدورك الحالي</div>) : !occupiedNow && (
            offShift ? (
              <div style={{ marginTop: 12, fontSize: 12, color: "var(--rust)", background: "#F4E7E2", borderRadius: 8, padding: 10, display: "flex", alignItems: "center", gap: 4 }}>
                <AlertTriangle size={13} /> {shiftClosed ? "شيفتك مقفول - لازم المدير العام أو مدير الحجوزات يفتحوه تاني عشان تقدر تعدّل حالة الغرف." : "مش شيفتك دلوقتي - الحالة مش هتتعدل غير وقت شيفتك اللي حاجزه."}
              </div>
            ) : (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 6 }}>حالة الغرفة</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{MANUAL_STATUS_OPTIONS.map((o) => <button key={o.key} className="cx-btn cx-btn-outline" style={{ fontSize: 12 }} onClick={() => saveOverride(o.key)}>{o.label}</button>)}</div>
              </div>
            )
          )}
        </div>
        );
      })()}
    </div>
  );
}
