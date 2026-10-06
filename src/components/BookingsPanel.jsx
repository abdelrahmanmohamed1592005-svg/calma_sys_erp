import React, { useState, useEffect } from "react";
import { Pencil, Trash2, AlertTriangle, Check, Plus, Printer, Lock } from "lucide-react";
import { TwoStepButton, PaymentDetailsInline, Logo } from "./shared";
import { fmt, COMMON_CURRENCIES, PAYMENT_METHODS, methodOptionsFor, ONLINE_METHODS, emptyPaymentDetails, bookingGrandTotal, onlineNetAmount, refundDueAmount } from "../domain/money";
import { todayStr, shiftDayNow, addDays, nightsBetween, uid, arabicDateLong } from "../domain/dates";
import { sourceOptionsFor, BOOKING_STATUSES, HOTEL_NAME, roomLabel } from "../domain/constants";
import { findOverlappingBookings, planDuplicateResolution, repricedTotalRoom, earlyLeavePatch } from "../domain/bookingLogic";
import { useShiftGate } from "../hooks/useShiftGate";
import { appendBookingCollection } from "../data/shifts";
import { withBusy } from "../lib/busy";

function emptyBooking() {
  return { id: uid(), code: "", room: "", guestName: "", phone: "", pax: 1, checkin: todayStr(), checkout: addDays(todayStr(), 1), priceNight: "", currency: "USD", totalRoom: "", extras: { laundry: "", cafeteria: "", tours: "", pickup: "" }, earlyCheckin: { applied: false, fee: "", note: "" }, paymentMethod: "كاش", paymentDetails: emptyPaymentDetails(), amountPaid: "", amountTendered: "", source: "مباشر", status: "مؤكد", approvalStatus: "approved", settled: false, notes: "", imported: false, needsRoomReview: false, duplicateConfirmed: false };
}

export function BookingsPanel({ rooms, bookings, perms, role, profile, onInsertBooking, onUpdateBooking, onDeleteBooking, onDecideRefund, onLog, showToast, pendingEditId, onConsumeEditRequest, dataVersion }) {
  const [form, setForm] = useState(null);
  const [filter, setFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  // نفس هوك شيفت موظف الشيفت المستخدم في RoomBoard.jsx بالظبط - عشان لو
  // شيفته مش حاجزه دلوقتي أو شيفته مقفول، ميعرفش يضيف أو يعدّل أي حجز من هنا
  // برده (مش بس من بلوك الغرف)، ومن غير أي تضارب بين الشاشتين.
  const { offShift, shiftClosed, myActiveShiftKey, myActiveShiftDate } = useShiftGate(profile, perms, dataVersion);

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
  // لما مدير الحجوزات يعدّل تواريخ حجز موجود (تمديد/تقصير)، إجمالي الغرفة بيتحرك
  // تلقائيًا بنفس سعر الليلة المتفق عليه - من غير ما يحتاج يفتح قفل الأسعار
  // (القفل لسه موجود على السعر نفسه). null = مفيش إعادة حساب (حجز جديد).
  const lockedRepricedTotal = form && chargeLocked && originalBooking ? repricedTotalRoom(originalBooking, form.checkin, form.checkout) : null;
  const roomTotalNow = lockedRepricedTotal != null ? lockedRepricedTotal : (Number(form?.totalRoom || autoTotalRoom) || 0);
  const earlyFee = form && form.earlyCheckin?.applied ? Number(form.earlyCheckin.fee) || 0 : 0;
  const grandTotal = form ? roomTotalNow + (Number(form.extras.laundry) || 0) + (Number(form.extras.cafeteria) || 0) + (Number(form.extras.tours) || 0) + (Number(form.extras.pickup) || 0) + earlyFee : 0;
  const balanceDue = form ? grandTotal - (Number(form.amountPaid) || 0) : 0;
  const changeDue = form && form.paymentMethod === "كاش" && form.amountTendered !== "" ? (Number(form.amountTendered) || 0) - grandTotal : null;
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
      const r = await onUpdateBooking(d.updated.id, { ...d.updated, checkout: d.original.checkout, totalRoom: d.original.totalRoom, settled: d.original.settled, status: d.original.status, leftEarly: d.original.leftEarly, notes: d.original.notes });
      if (r?.error) allOk = false;
    }
    return allOk;
  }

  async function saveBooking() { return withBusy(saveBookingInner); }
  async function saveBookingInner() {
    if (perms.roomStatusRestricted && offShift) { showToast(shiftClosed ? "شيفتك مقفول - لازم المدير العام أو مدير الحجوزات يفتحوه تاني عشان تقدر تضيف أو تعدّل حجز" : "مش شيفتك دلوقتي - الحجوزات بتتضاف/تتعدل وقت شيفتك اللي حاجزه بس"); return; }
    if (!form.room || !form.guestName.trim()) { showToast("لازم تحدد الغرفة واسم النزيل"); return; }
    // الحجز اتعدّل من مكان تاني (غالبًا تحصيل من موظف الشيفت) وإحنا فاتحين
    // الفورم: نحدّث نسخته المرجعية ونطلب مراجعة، بدل ما كل حفظة بعد كده تفشل
    // بـ"تعارض" والفورم يفضل متعلّق على نسخة قديمة.
    if (isExistingBooking && originalBooking && form.updatedAt && originalBooking.updatedAt && form.updatedAt !== originalBooking.updatedAt) {
      setForm((f) => ({ ...f, updatedAt: originalBooking.updatedAt, amountPaid: originalBooking.amountPaid, amountTendered: originalBooking.amountTendered, settled: originalBooking.settled }));
      showToast("الحجز ده اتحدّث من مكان تاني وانت بتعدّل فيه (غالبًا تحصيل) - راجع القيم الجديدة واضغط حفظ تاني");
      return;
    }
    // تاريخ الخروج لازم يكون بعد تاريخ الدخول - من غير الفحص ده هنوصل لقيد
    // قاعدة البيانات (bookings_dates_valid) وتظهر رسالة تقنية مش مفهومة.
    const zeroNightOk = isExistingBooking && !!originalBooking?.leftEarly && form.checkout === form.checkin;
    if (!form.checkin || !form.checkout || form.checkout < form.checkin || (form.checkout === form.checkin && !zeroNightOk)) { showToast("تاريخ الخروج لازم يكون بعد تاريخ الدخول"); return; }
    if (conflict && !form.duplicateConfirmed) { showToast(`الغرفة متعارضة مع حجز موجود: ${clashesNow.map(clashLabel).join(" / ")} - لو ده تسكين مكرر شرعي فعّل تأكيد "تسكين مكرر" تحت`); return; }
    // الخطة بتتحسب وتتأكد منها كلها قبل ما أي حجز قديم يتلمس، فلو فيه أي حجز
    // قديم مش ينفع يتسكّن تلقائيًا (حجز مستقبلي فعلاً) مفيش حاجة بتتغيّر خالص.
    if (conflict && form.duplicateConfirmed && duplicatePlan && !duplicatePlan.ok) {
      showToast(duplicateBlockedText(duplicatePlan));
      return;
    }
    // منع أي قيمة سالبة في الرسوم الإضافية/رسم الدخول المبكر من غير داعي
    // تضرب قيد قاعدة البيانات وتطلّع رسالة خطأ تقنية مش مفهومة.
    const clampedExtras = { laundry: Math.max(0, Number(form.extras.laundry) || 0), cafeteria: Math.max(0, Number(form.extras.cafeteria) || 0), tours: Math.max(0, Number(form.extras.tours) || 0), pickup: Math.max(0, Number(form.extras.pickup) || 0) };
    const clampedEarlyCheckin = { ...form.earlyCheckin, fee: Math.max(0, Number(form.earlyCheckin?.fee) || 0) };
    let cleaned = { ...form, room: Number(form.room), totalRoom: form.totalRoom !== "" ? Number(form.totalRoom) : autoTotalRoom, extras: clampedExtras, earlyCheckin: clampedEarlyCheckin, needsRoomReview: false, approvalStatus: "approved" };
    // قفل قيمة الحجز (سعر/إجمالي/رسوم/دخول مبكر/طريقة دفع): لو مدير حجوزات
    // بيعدّل حجز قديم، أو لو الحجز متحصّل بالكامل فعلاً ولسه كذلك - نفرض
    // القيم الأصلية حتى لو الواجهة اتلعب فيها بأي طريقة (دفاع إضافي، القفل
    // الحقيقي في قاعدة البيانات نفسها - قسم ١٤/١٧ في schema.sql). الاستثناء
    // الوحيد إجمالي الغرفة: بيتحرك مع عدد الليالي (تمديد/تقصير) بنفس سعر الليلة.
    if (chargeLocked && originalBooking) {
      cleaned = { ...cleaned, priceNight: originalBooking.priceNight, currency: originalBooking.currency, totalRoom: lockedRepricedTotal, extras: originalBooking.extras, earlyCheckin: originalBooking.earlyCheckin, paymentMethod: originalBooking.paymentMethod, paymentDetails: originalBooking.paymentDetails };
    }
    // قفل التحصيل (المدفوع/المتحصّل نقدًا/تم التحصيل بالكامل): مدير الحجوزات
    // بس ملوش دعوة بالتحصيل خالص - حجز جديد أو حجز مش مقفول بالكامل بيترجع
    // لقيمته الأصلية (أو صفر لحجز جديد) حتى لو الواجهة اتلعب فيها.
    if (moneyLocked && originalBooking) {
      cleaned = { ...cleaned, amountPaid: originalBooking.amountPaid, amountTendered: originalBooking.amountTendered, settled: originalBooking.settled };
    } else if (collectionLocked) {
      cleaned = { ...cleaned, amountPaid: originalBooking ? originalBooking.amountPaid : 0, amountTendered: originalBooking ? originalBooking.amountTendered : 0, settled: originalBooking ? originalBooking.settled : false };
    }
    // لو الحجز كان "متحصّل بالكامل" وإجماليه زاد (تمديد/ليالي إضافية) بقى فيه
    // متبقي - علامة "متحصّل" بتتشال تلقائيًا (الغرفة تبقى حمراء لحد ما موظف
    // الشيفت يحصّل الفرق)، ومدير الحجوزات مايحتاجش يلغي التحصيل بإيده (مش من
    // صلاحيته أصلًا). قاعدة البيانات بتسمح بالحالة دي بس (قسم ١٤).
    let reopenedDue = 0;
    if (originalBooking?.settled && cleaned.settled) {
      const gtAfter = bookingGrandTotal(cleaned);
      const paidNow = Number(cleaned.amountPaid) || 0;
      const isOnline = !!cleaned.paymentDetails?.onlinePaid;
      if (gtAfter !== bookingGrandTotal(originalBooking)) {
        if (isOnline || gtAfter > paidNow) {
          cleaned = { ...cleaned, settled: false };
          if (!isOnline) reopenedDue = gtAfter - paidNow;
        }
        // (الإجمالي نقص بسبب تقصير ليالي والمدفوع لسه مغطّيه: العلامة بتفضل،
        // والزيادة المدفوعة بتتحوّل تلقائيًا لطلب رد فلوس لمدير الحجوزات.)
      }
    }
    // مينفعش "متحصّل بالكامل" يتسجل والمدفوع لسه أقل من الإجمالي الكلي - دفاع
    // إضافي هنا (الشرط الحقيقي في قاعدة البيانات - قسم ٢٤ في schema.sql)،
    // عشان مايحصلش حجز متحصّل بالكامل وعليه متبقي في نفس الوقت.
    if (!cleaned.paymentDetails?.onlinePaid && cleaned.settled) {
      const gtNow = bookingGrandTotal(cleaned);
      if ((Number(cleaned.amountPaid) || 0) < gtNow) { showToast(`مينفعش تعلّمي "متحصّل بالكامل" وفيه ${fmt(gtNow - (Number(cleaned.amountPaid) || 0))} ${cleaned.currency} لسه متبقية`); return; }
    }
    // "تسكين مكرر" (الخطة اتأكدت فوق إنها سليمة): لكل حجز قديم متعارض -
    // - بدأ قبل الجديد: نقصّر تاريخ خروجه لتاريخ دخول الجديد ونعلّمه "غادر مبكرًا"
    //   (مش "ملغي"، عشان إيراد الليالي اللي قعدها فعلاً يفضل محسوب صحيح).
    // - نزل نفس يوم الجديد وخرج (ماقعدش أي ليلة): بيتسجّل "غادر مبكرًا" برضه
    //   (خروجه = دخوله، إجماليه صفر)، ولو كان مدفوع عليه حاجة بتتفتح تلقائيًا
    //   طلب رد فلوس لمدير الحجوزات.
    // لو حفظ الحجز الجديد فشل بعد كده، كل اللي اتغيّر بيترجع تاني تلقائيًا.
    const resolved = [];
    const refundRequests = [];
    if (conflict && form.duplicateConfirmed && duplicatePlan?.ok) {
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
    const paidDelta = (Number(cleaned.amountPaid) || 0) - (originalBooking ? Number(originalBooking.amountPaid) || 0 : 0);
    let note = "";
    if (paidDelta !== 0 && myActiveShiftKey) {
      const ledgerRes = await appendBookingCollection(myActiveShiftDate || shiftDayNow(), myActiveShiftKey, profile, rooms, {
        id: uid(), bookingId: savedId, room: cleaned.room, guestName: cleaned.guestName,
        amount: paidDelta, currency: cleaned.currency, method: cleaned.paymentMethod,
        note: isExistingBooking ? "فرق مدفوع بتعديل حجز" : "تحصيل حجز جديد", at: Date.now(),
      });
      if (ledgerRes?.error) note += " — لكن تعذر تسجيله تلقائيًا في اليومية، سجّليه يدويًا: " + ledgerRes.error;
    } else if (paidDelta !== 0) {
      note += " — ⚠ مفيش شيفتك شغال دلوقتي فالمبلغ ماتسجّلش في اليومية تلقائيًا، سجّليه يدويًا";
    }
    if (reopenedDue > 0) note += ` — الحجز عليه ${fmt(reopenedDue)} ${cleaned.currency} متبقي (فرق الليالي) والغرفة هتظهر حمراء لحد ما موظف الشيفت يحصّله`;
    const paidAfter = Number(cleaned.amountPaid) || 0;
    if (!cleaned.paymentDetails?.onlinePaid && isExistingBooking && paidAfter > bookingGrandTotal(cleaned) && cleaned.status !== "ملغي") note += ` — ⚠ المدفوع (${fmt(paidAfter)}) بقى أكبر من الإجمالي الجديد بـ ${fmt(paidAfter - bookingGrandTotal(cleaned))} ${cleaned.currency} - فيه فلوس زيادة لازم تترد للنزيل`;
    if (cleaned.status === "ملغي" && originalBooking?.status !== "ملغي" && paidAfter > 0) note += ` — الحجز اتلغى وفيه ${fmt(paidAfter)} ${cleaned.currency} متحصّل: اتبعت طلب رد فلوس لمدير الحجوزات (هو اللي يقرر يرد أو يرفض، ولو رد بيتشال من التحصيل واليومية)`;
    refundRequests.forEach((c) => { note += ` — ${c.guestName} غادر مبكرًا وفيه ${fmt((Number(c.amountPaid) || 0) - bookingGrandTotal(c))} ${c.currency} زيادة عن اللي استحقه: اتبعت طلب رد فلوس لمدير الحجوزات يقرر فيه`; });
    setForm(null); showToast("تم الحفظ" + note);
  }
  async function removeBooking(id) { const b = bookings.find((x) => x.id === id); const res = await onDeleteBooking(id); if (res?.error) { showToast(res.error); return; } onLog(`حذف حجز ${roomLabel(rooms, b?.room)} — ${b?.guestName}`); showToast("تم الحذف"); }

  // قرار طلب رد الفلوس (مدير الحجوزات بس): "refund" = رد فعلي (بيتشال من
  // المدفوع وبيتسجّل بالسالب في صف الغرفة في يومية الشيفت المفتوح، كله في
  // معاملة واحدة في قاعدة البيانات)، "keep" = رفض الرد والفلوس تفضل متحصّلة.
  const [refundMethods, setRefundMethods] = useState({});
  async function decideRefund(b, decision) { return withBusy(() => decideRefundInner(b, decision)); }
  async function decideRefundInner(b, decision) {
    const amount = refundDueAmount(b);
    const method = refundMethods[b.id] || b.paymentMethod;
    const res = await onDecideRefund(b, decision, method);
    if (res?.error) { showToast(res.error); return; }
    if (decision === "keep") {
      onLog(`رفض رد فلوس - ${roomLabel(rooms, b.room)} - ${b.guestName} - ${fmt(amount)} ${b.currency} (الفلوس فضلت متحصّلة)`);
      showToast("تم رفض الرد - الفلوس فضلت متحصّلة على الحجز");
      return;
    }
    onLog(`رد فلوس - ${roomLabel(rooms, b.room)} - ${b.guestName} - ${fmt(amount)} ${b.currency} (${method})`);
    showToast(`تم رد ${fmt(res?.data?.amount ?? amount)} ${b.currency} - اتشالت من التحصيل واليومية`);
  }

  const list = bookings.filter((b) => {
    if (filter && !String(b.room).includes(filter) && !b.guestName.includes(filter) && !(b.code && b.code.includes(filter))) return false;
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
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 8 }}>
            <div><label style={{ fontSize: 11, color: "var(--muted)" }}>كود الحجز (اختياري)</label><input className="cx-input" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></div>
            <div><label style={{ fontSize: 11, color: "var(--muted)" }}>الغرفة</label><select className="cx-select" value={form.room} onChange={(e) => onRoomChange(e.target.value)}><option value="">اختر</option>{rooms.map((r) => <option key={r.number} value={r.number}>{r.name || `غرفة ${r.number}`}</option>)}</select></div>
            <div><label style={{ fontSize: 11, color: "var(--muted)" }}>اسم النزيل</label><input className="cx-input" value={form.guestName} onChange={(e) => setForm({ ...form, guestName: e.target.value })} /></div>
            <div><label style={{ fontSize: 11, color: "var(--muted)" }}>الهاتف</label><input className="cx-input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
            <div><label style={{ fontSize: 11, color: "var(--muted)" }}>عدد الأفراد</label><input className="cx-input" type="number" min="1" value={form.pax} onChange={(e) => setForm({ ...form, pax: e.target.value })} /></div>
            <div><label style={{ fontSize: 11, color: "var(--muted)" }}>تاريخ الدخول</label><input className="cx-input" type="date" value={form.checkin} onChange={(e) => { const newCheckin = e.target.value; setForm((f) => ({ ...f, checkin: newCheckin, checkout: f.checkout && f.checkout > newCheckin ? f.checkout : addDays(newCheckin, 1) })); }} /></div>
            <div><label style={{ fontSize: 11, color: "var(--muted)" }}>تاريخ الخروج</label><input className="cx-input" type="date" min={form.checkin ? addDays(form.checkin, 1) : undefined} value={form.checkout} onChange={(e) => setForm({ ...form, checkout: e.target.value })} /></div>
            <div><label style={{ fontSize: 11, color: "var(--muted)" }}>السعر لليلة {chargeLocked && <Lock size={10} style={{ verticalAlign: -1 }} />}</label><div style={{ display: "flex", gap: 4 }}><input className="cx-input" type="number" disabled={chargeLocked} value={form.priceNight} onChange={(e) => setForm({ ...form, priceNight: e.target.value })} /><select className="cx-select" disabled={chargeLocked} value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} style={{ width: 90 }}>{COMMON_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}</select></div></div>
            <div><label style={{ fontSize: 11, color: "var(--muted)" }}>إجمالي الغرفة ({nights} ليلة) {chargeLocked && <Lock size={10} style={{ verticalAlign: -1 }} />}</label><input className="cx-input" type="number" disabled={chargeLocked} placeholder={String(autoTotalRoom)} value={lockedRepricedTotal != null ? lockedRepricedTotal : form.totalRoom} onChange={(e) => setForm({ ...form, totalRoom: e.target.value })} /></div>
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

          {lockedRepricedTotal != null && originalBooking && lockedRepricedTotal !== (Number(originalBooking.totalRoom) || 0) && (
            <div style={{ marginTop: 10, fontSize: 12, color: "var(--teal)", background: "var(--paper2)", borderRadius: 8, padding: 8 }}>
              عدد الليالي اتغيّر ({nightsBetween(originalBooking.checkin, originalBooking.checkout)} ← {nights}) - إجمالي الغرفة اتحرك تلقائيًا من {fmt(originalBooking.totalRoom)} إلى {fmt(lockedRepricedTotal)} {form.currency} بنفس سعر الليلة. {originalBooking.settled && !originalBooking.paymentDetails?.onlinePaid && lockedRepricedTotal > (Number(originalBooking.totalRoom) || 0) ? "علامة \"متحصّل بالكامل\" هتتشال تلقائيًا ويظهر المتبقي." : ""}
            </div>
          )}
          {form.status === "ملغي" && (isExistingBooking ? originalBooking?.status !== "ملغي" : true) && (Number(isExistingBooking ? originalBooking?.amountPaid : form.amountPaid) || 0) > 0 && (
            <div style={{ marginTop: 10, fontSize: 12, color: "var(--rust)", background: "#F4E7E2", borderRadius: 8, padding: 8 }}>
              <AlertTriangle size={13} style={{ verticalAlign: -2 }} /> الحجز ده عليه {fmt(originalBooking?.amountPaid ?? form.amountPaid)} {form.currency} متحصّل - بعد الإلغاء هيتفتح طلب رد فلوس ليك في قائمة الحجوزات: تقدر ترد الفلوس (بتتشال من التحصيل واليومية والتقرير) أو ترفض الرد وتسيبها متحصّلة. الحجز نفسه بيفضل ظاهر في القائمة كحجز ملغي.
            </div>
          )}

          {conflict && (
            <div style={{ marginTop: 10, color: "var(--rust)", fontSize: 12.5, background: "#F4E7E2", borderRadius: 8, padding: 10 }}>
              <div style={{ marginBottom: 6 }}><AlertTriangle size={13} style={{ verticalAlign: -2 }} /> تنبيه: الغرفة دي محجوزة بالفعل في تواريخ متداخلة مع: {clashesNow.map(clashLabel).join(" / ")}</div>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 700, opacity: duplicatePlan && !duplicatePlan.ok ? 0.55 : 1 }}><input type="checkbox" disabled={!!duplicatePlan && !duplicatePlan.ok} checked={!!form.duplicateConfirmed && !!duplicatePlan?.ok} onChange={(e) => setForm({ ...form, duplicateConfirmed: e.target.checked })} /> تسكين مكرر - الضيف اللي قبله خرج بدري من الغرفة، وده حجز جديد شرعي بتفاصيل جديدة</label>
              {duplicatePlan && !duplicatePlan.ok && (
                <div style={{ marginTop: 6, fontWeight: 400 }}>
                  {duplicateBlockedText(duplicatePlan)}
                </div>
              )}
              {duplicatePlan?.ok && form.duplicateConfirmed && (
                <div style={{ marginTop: 6, fontWeight: 400, color: "var(--teal)" }}>
                  اللي هيحصل عند الحفظ: {duplicatePlan.actions.map((act) => act.action === "trim"
                    ? `${act.clash.guestName} هيتسجّل "غادر مبكرًا" وخروجه يتقصّر لـ ${act.checkout} (بيتحاسب على الليالي اللي قعدها بس)`
                    : `${act.clash.guestName} (دخل ${act.clash.checkin} وخرج في نفس اليوم) هيتسجّل "غادر مبكرًا" بصفر ليالي${(Number(act.clash.amountPaid) || 0) > 0 ? ` وفلوسه (${fmt(act.clash.amountPaid)} ${act.clash.currency}) هتتبعت كطلب رد فلوس لمدير الحجوزات يقرر فيه` : ""}`).join(" · ")} - والحجزين بتفاصيلهم يفضلوا ظاهرين في القائمة.
                </div>
              )}
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
              <div style={{ fontWeight: 800 }}>{roomLabel(rooms, b.room)} · {b.guestName} {b.paymentDetails?.onlinePaid && <span className="cx-pill" style={{ background: "#EDE8F5", color: "#7A5FB5", marginRight: 6 }}>مدفوع أونلاين</span>} {b.leftEarly && <span className="cx-pill" style={{ background: "#FBE9DA", color: "var(--rust)", marginRight: 6 }}>غادر مبكرًا</span>} {b.duplicatePlacement && <span className="cx-pill" style={{ background: "#EDE8F5", color: "#6B4FA0", marginRight: 6 }}>تسكين مكرر</span>} {b.settled && <span className="cx-pill" style={{ background: "#EAF2EC", color: "var(--sage)", marginRight: 6 }}>متحصّل بالكامل</span>} {b.refundDecision === "refunded" && b.refundedAmount > 0 && <span className="cx-pill" style={{ background: "#EFEEEC", color: "#6B6357", marginRight: 6 }}>اترد {fmt(b.refundedAmount)} {b.currency}</span>}</div>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>{b.checkin} → {b.checkout} · {nightsBetween(b.checkin, b.checkout)} ليلة · {b.pax} أفراد {b.code && `· كود ${b.code}`}</div>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>{b.source} · {b.paymentMethod}{b.paymentDetails?.senderName ? ` (${b.paymentDetails.senderName} · ${b.paymentDetails.senderNumber})` : ""} · الإجمالي {fmt(gt)} {b.currency} {due > 0 && !b.paymentDetails?.onlinePaid && b.status !== "ملغي" && <span style={{ color: "var(--rust)" }}>· متبقي {fmt(due)}</span>}</div>
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
            {/* طلب رد فلوس (حجز ملغي، أو إقامة اتقصّرت والمدفوع زاد عن إجماليها):
                بيتفتح تلقائيًا في قاعدة البيانات، وقراره (رد فعلي أو رفض
                وإبقاء الفلوس) لمدير الحجوزات بس - decide_booking_refund. */}
            {b.refundPending && refundDueAmount(b) > 0 && (
              <div className="cx-no-print" data-testid="refund-request" style={{ width: "100%", marginTop: 4, background: "#FBE2E4", borderRadius: 8, padding: 8, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: 12, color: "var(--rust)", fontWeight: 700 }}><AlertTriangle size={12} style={{ verticalAlign: -1 }} /> طلب رد فلوس: {fmt(refundDueAmount(b))} {b.currency} ({b.paymentMethod}) {b.status === "ملغي" ? "- حجز ملغي" : "- زيادة عن إجمالي الإقامة الحالي (تقصير/خروج مبكر/تخفيض)"}</span>
                {perms.decideRefund ? (
                  <span style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                    <select className="cx-select" title="وسيلة رد الفلوس للنزيل (اللي هتتخصم من اليومية)" style={{ width: 130 }} value={refundMethods[b.id] || b.paymentMethod} onChange={(e) => setRefundMethods({ ...refundMethods, [b.id]: e.target.value })}>
                      {methodOptionsFor(b.paymentMethod).map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                    <TwoStepButton label="رد الفلوس" confirmLabel="تأكيد الرد؟" onConfirm={() => decideRefund(b, "refund")} />
                    <TwoStepButton label="رفض الرد (الفلوس تفضل)" confirmLabel="تأكيد الرفض؟" onConfirm={() => decideRefund(b, "keep")} />
                  </span>
                ) : (
                  <span style={{ fontSize: 11, color: "var(--muted)" }}>في انتظار قرار مدير الحجوزات</span>
                )}
              </div>
            )}
            {!b.refundPending && b.refundDecision === "kept" && (
              <div className="cx-no-print" style={{ width: "100%", fontSize: 11, color: "var(--muted)" }}>مدير الحجوزات رفض رد الفلوس - المبلغ المتحصّل ({fmt(b.amountPaid)} {b.currency}) فضل على الحجز</div>
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
