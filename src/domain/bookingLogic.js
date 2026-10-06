import { addDays, todayStr, nightsBetween } from "./dates";
import { bookingGrandTotal } from "./money";
import { MANUAL_STATUS_OPTIONS } from "./constants";

export function isOverrideStillActive(ov, dateStr) {
  if (!ov) return false;
  if (ov.status === "maintenance") return true; // الصيانة بتفضل لحد ما حد يشيلها يدويًا
  const d = new Date(ov.updatedAt);
  const setDateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return setDateStr === dateStr; // باقي الحالات صالحة ليوم واحد بس وبترجع تلقائي بعده
}

export function computeRoomStatus(roomNumber, bookings, overrides, dateStr) {
  const ov = overrides[roomNumber];
  if (ov && ov.status && ov.status !== "auto" && isOverrideStillActive(ov, dateStr)) {
    const opt = MANUAL_STATUS_OPTIONS.find((o) => o.key === ov.status);
    return { key: ov.status, label: opt ? opt.label : ov.status, source: "manual" };
  }
  const active = bookings.find((b) => b.room === roomNumber && b.status !== "ملغي" && b.checkin <= dateStr && dateStr < b.checkout);
  if (active) {
    const gt = bookingGrandTotal(active);
    // "متحصّل" = المدفوع فعلًا وصل للإجمالي الحالي (أو مدفوع أونلاين) - مش
    // علامة settled لوحدها: لو الإجمالي زاد (تمديد/رسوم) والمدفوع لسه أقل،
    // الغرفة لازم تظهر "متبقي عليها فلوس" حتى لو العلامة القديمة لسه موجودة.
    const paid = !!active.paymentDetails?.onlinePaid || (Number(active.amountPaid) || 0) >= gt;
    return { key: paid ? "occupied_paid" : "occupied_unpaid", label: paid ? "مشغولة - متحصّل بالكامل" : "مشغولة - متبقي عليها فلوس", guest: active.guestName, booking: active, paid };
  }
  const upcoming = bookings.find((b) => b.room === roomNumber && b.status !== "ملغي" && b.checkin > dateStr && b.checkin <= addDays(dateStr, 2));
  if (upcoming) return { key: "reserved", label: "قادمة قريبًا", guest: upcoming.guestName, booking: upcoming };
  return { key: "available", label: "متاحة" };
}

export function roomsOverlap(bookings, room, checkin, checkout, excludeId) {
  return bookings.some((b) => b.id !== excludeId && b.room === room && b.status !== "ملغي" && b.checkout > b.checkin && !(checkout <= b.checkin || checkin >= b.checkout));
}

/* بترجع الحجز الفعلي المتعارض (مش بس true/false) عشان لو الموظف أكّد "تسكين
   مكرر" (الضيف القديم خرج بدري)، نقدر نقصّر تاريخ خروج الحجز القديم لحد
   تاريخ دخول الحجز الجديد تلقائيًا - فمايفضلش فيه تعارض حقيقي في التواريخ،
   وقيد منع الحجز المزدوج في قاعدة البيانات (وهو قيد صحيح ومهم) ميرفضش
   العملية الشرعية دي. */
export function findOverlappingBooking(bookings, room, checkin, checkout, excludeId) {
  return bookings.find((b) => b.id !== excludeId && b.room === room && b.status !== "ملغي" && b.checkout > b.checkin && !(checkout <= b.checkin || checkin >= b.checkout)) || null;
}

/* كل الحجوزات الفعلية المتعارضة (مش بس أول واحد) - ممكن تسكين مكرر واحد
   يتعارض مع أكتر من حجز قديم في نفس الغرفة (مثلاً حجزين متتاليين لنفس
   الغرفة والحجز الجديد بيغطي جزء من الاتنين). */
export function findOverlappingBookings(bookings, room, checkin, checkout, excludeId) {
  return bookings.filter((b) => b.id !== excludeId && b.room === room && b.status !== "ملغي" && b.checkout > b.checkin && !(checkout <= b.checkin || checkin >= b.checkout));
}

/* قرار "تسكين مكرر" بالنسبة لحجز قديم متعارض واحد (clash)، منفصل عن أي
   استدعاء شبكة عشان يتختبر لوحده. today = تاريخ النهارده (YYYY-MM-DD).
   "بدأ فعلاً" = تاريخ دخوله النهارده أو قبله (النظام بيتعامل بالتواريخ بس،
   مفيش ساعة). كل نزيل قديم بدأ فعلاً وخرج بدري بيتسجّل "غادر مبكرًا" - مش
   "ملغي" أبدًا (الإلغاء قرار مدير الحجوزات بس):
   - "trim": دخل قبل يوم دخول الجديد: خروجه بيتقصّر لتاريخ دخول الجديد
     والإجمالي بيتعاد تسعيره على الليالي اللي قعدها فعلاً.
   - "early_leave_same_day": دخل في نفس يوم دخول الجديد وخرج (ماقعدش أي ليلة):
     بيتسجّل "غادر مبكرًا" وخروجه = دخوله (صفر ليالي) والإجمالي بيبقى صفر.
   في الحالتين لو المدفوع بقى أكبر من الإجمالي الجديد، قاعدة البيانات بتفتح
   تلقائيًا "طلب رد فلوس" لمدير الحجوزات يقرر فيه (رد أو رفض).
   - الحجز القديم بيبدأ بعد النهارده (حجز مستقبلي فعلاً): ده مش خروج مبكر
     ولا تسكين مكرر - ده حجز مزدوج حقيقي وإلغاؤه قرار مدير الحجوزات يدويًا.
   - الجديد بيبدأ بعد النهارده والقديم لسه نزيله في الغرفة: مرفوض، مدير
     الحجوزات يعدّل خروج القديم الأول.
   - الجديد بيبدأ قبل القديم (تواريخ مش منطقية): مرفوض، يتصلّح يدويًا. */
export function resolveDuplicateCheckin(clash, newCheckin, today = todayStr()) {
  if (!clash) return null;
  if (clash.checkin > today) return { action: "needs_manual_cancel", reason: "future" };
  if (newCheckin > today) return { action: "needs_manual_cancel", reason: "new_in_future" };
  if (clash.checkin < newCheckin) return { action: "trim", checkout: newCheckin };
  if (clash.checkin === newCheckin) return { action: "early_leave_same_day", checkout: clash.checkin };
  return { action: "needs_manual_cancel", reason: "starts_before_old" };
}

/* التعديلات اللي بتتطبق على حجز قديم "غادر مبكرًا" في تسكين مكرر: تاريخ
   الخروج الجديد، إجمالي الغرفة بعد إعادة التسعير على الليالي الفعلية،
   وعلامة التحصيل (بتفضل بس لو المدفوع لسه مغطّي الإجمالي الجديد). */
export function earlyLeavePatch(clash, newCheckout) {
  const totalRoom = repricedTotalRoom(clash, clash.checkin, newCheckout);
  const next = { ...clash, checkout: newCheckout, totalRoom };
  const online = !!clash.paymentDetails?.onlinePaid;
  const settled = !!clash.settled && (online || (Number(clash.amountPaid) || 0) >= bookingGrandTotal(next));
  const note = newCheckout === clash.checkin
    ? `غادر مبكرًا في نفس يوم الدخول (${clash.checkin}) - الغرفة اتسلمت لحجز تسكين مكرر جديد`
    : `غادر مبكرًا في ${newCheckout} - الغرفة اتسلمت لحجز تسكين مكرر جديد`;
  return { checkout: newCheckout, totalRoom, settled, status: "تم تسجيل الخروج", leftEarly: true, notes: (clash.notes ? clash.notes + " — " : "") + note };
}

/* خطة تسكين مكرر كاملة لكل الحجوزات القديمة المتعارضة - بترجع إما رفض
   (ولا حاجة اتغيّرت لسه) أو قايمة إجراءات تتنفذ بالترتيب. القرار كله بيتاخد
   قبل أي تعديل في قاعدة البيانات، فمفيش حالة نص-نص. */
export function planDuplicateResolution(clashes, newCheckin, today = todayStr()) {
  const actions = [];
  for (const clash of clashes || []) {
    const r = resolveDuplicateCheckin(clash, newCheckin, today);
    if (!r) continue;
    if (r.action === "needs_manual_cancel") return { ok: false, reason: r.reason, clash };
    actions.push({ clash, ...r });
  }
  return { ok: true, actions };
}

/* لما مدير الحجوزات (أو الموظف في بلوك الغرف) يغيّر تاريخ خروج حجز موجود،
   إجمالي سعر الغرفة بيتحرك تلقائيًا من غير ما يحتاج يفتح قفل الأسعار - نفس
   حساب reprice_total في قاعدة البيانات بالظبط (schema.sql):
   - تمديد: الإجمالي الحالي + سعر الليلة × الليالي الزيادة.
   - تقصير: الإجمالي الحالي × (الليالي الجديدة ÷ القديمة) - متوسط سعر الليلة
     الفعلي (يراعي أي خصم/سعر مخصوص متفق عليه)، وصفر ليالي = صفر. */
export function repricedTotalRoom(original, newCheckin, newCheckout) {
  const oldNights = nightsBetween(original.checkin, original.checkout);
  const newNights = nightsBetween(newCheckin, newCheckout);
  const base = Number(original.totalRoom) || 0;
  if (oldNights === newNights) return base;
  if (newNights <= 0) return 0;
  if (newNights > oldNights) return base + (newNights - oldNights) * (Number(original.priceNight) || 0);
  if (oldNights <= 0) return base;
  return Math.round(base * newNights * 100 / oldNights) / 100;
}
