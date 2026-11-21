import { supabase } from "../lib/supabaseClient";
import { isMissingFunctionError, OUTDATED_SCHEMA_MESSAGE } from "./schemaCheck";
import { bookingFxRate, otherDue, fxRatesNeeded } from "../domain/money";

/* تسجيل الفلوس بعملية واحدة ذرية في قاعدة البيانات (كله أو ولا حاجة): الحجز + صف الوسيلة في اليومية + كافيتيريا النزيل.
   التحقق (المبلغ ≤ المتبقي، الوسيلة، آخر ٤ أرقام الفيزا، رقم تليفون التحويل) بيتنفّذ في القاعدة نفسها كمان.
   انظر قسم ٣٣ في schema.sql. */

// خطأ شبكة (مفيش كود من الـ API): ممكن العملية تكون اتسجّلت فعلًا والرد بس هو اللي ضاع
import { isNetworkError, reportDbError } from "../lib/errorReport";
const UNCERTAIN_NOTE = " - مش متأكدين إن العملية اتسجّلت (النت قطع): راجع المدفوع/اليومية قبل ما تعيد التسجيل عشان ما يتكرّرش";

async function rpc(name, args) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) {
    reportDbError(name, error);
    if (isMissingFunctionError(error)) return { error: OUTDATED_SCHEMA_MESSAGE + " (" + name + ")" };
    if (isNetworkError(error)) return { error: error.message + UNCERTAIN_NOTE, uncertain: true };
    return { error: error.message };
  }
  return { data };
}

/* expectedUpdatedAt: آخر نسخة من الحجز اللي الشاشة شايفاها. لو الدفعة اتسجّلت فعلًا والرد ضاع وضغط المستخدم تاني بنفس النسخة القديمة،
   القاعدة بترفض (الحجز اتغيّر) بدل ما تسجّل نفس الدفعة مرتين. */
export const recordBookingPayment = ({ bookingId, amount, method, details, note, expectedUpdatedAt }) =>
  rpc("record_booking_payment", { p_booking: bookingId, p_amount: amount, p_method: method, p_details: details || {}, p_expected: expectedUpdatedAt || null, p_note: note || "تحصيل" });

/* دفعة بعملة غير عملة الحجز: بتسدّد خدمات العملة دي بس (من غير أي تحويل) */
export const recordBookingPaymentOther = ({ bookingId, amount, currency, method, details, note, expectedUpdatedAt }) =>
  rpc("record_booking_payment_other", { p_booking: bookingId, p_amount: amount, p_currency: currency, p_method: method, p_details: details || {}, p_expected: expectedUpdatedAt || null, p_note: note || "تحصيل" });

/* دفعة بعملة غير عملة الحجز بسعر صرف: rate = كام وحدة من عملة الدفعة في كل 1 من عملة الحجز */
export const recordBookingPaymentFx = ({ bookingId, amount, currency, rate, method, details, note, expectedUpdatedAt }) =>
  rpc("record_booking_payment_fx", { p_booking: bookingId, p_amount: amount, p_currency: currency, p_rate: rate ?? null, p_method: method, p_details: details || {}, p_expected: expectedUpdatedAt || null, p_note: note || "تحصيل" });

/* نقل النزيل (الحجز كله) لغرفة تانية فاضية في نفس التواريخ */
export const moveBookingRoom = ({ bookingId, room, expectedUpdatedAt }) =>
  rpc("move_booking_room", { p_booking: bookingId, p_room: Number(room), p_expected: expectedUpdatedAt || null });

/* تعديل عملة الحجز (الأرقام زي ما هي) - بتتغيّر في الحجز وفي صفوف اليومية المفتوحة بتاعته مع بعض */
export const changeBookingCurrency = ({ bookingId, currency, expectedUpdatedAt }) =>
  rpc("change_booking_currency", { p_booking: bookingId, p_currency: currency, p_expected: expectedUpdatedAt || null });

// المطوّر (devHotel): نفس الدالة بس على الشيفت المفتوح في الفندق ده (هو مش واخد شيفت)
export const recordStaffCafeteria = ({ name, username, description, amount, currency, method, details, devHotel }) =>
  rpc(devHotel ? "dev_record_staff_cafeteria" : "record_staff_cafeteria", { ...(devHotel ? { p_hotel: devHotel } : {}), p_name: name, p_username: username || null, p_desc: description || "", p_amount: amount, p_currency: currency, p_method: method || null, p_details: details || null });

export const settleStaffCafeteria = ({ name, username, currency, amount, method, details, devHotel }) =>
  rpc(devHotel ? "dev_settle_staff_cafeteria" : "settle_staff_cafeteria", { ...(devHotel ? { p_hotel: devHotel } : {}), p_name: name, p_username: username || null, p_currency: currency, p_amount: amount, p_method: method, p_details: details || {} });

/* مبلغ اتدفع قبل استلام السيستم: بيتحسب في مدفوع الحجز والمتبقي من غير ما يدخل أي يومية/خزينة */
export const setBookingPriorPaid = ({ bookingId, amount, note, expectedUpdatedAt }) =>
  rpc("set_booking_prior_paid", { p_booking: bookingId, p_amount: Number(amount) || 0, p_note: note || null, p_expected: expectedUpdatedAt || null });

/* رسوم الفيزا: مبلغ بيحدده الموظف بيتدفع على الفيزا مع الدفعة - بيتحسب على النزيل وبيتسجّل في اليومية صف "رسوم فيزا" */
export const recordVisaFee = ({ bookingId, amount, details }) => rpc("record_visa_fee", { p_booking: bookingId, p_amount: Number(amount) || 0, p_details: details || {} });
/* المطوّر: يرجّع حجز اتلغى بالغلط (what = "uncancel") أو مغادرة مبكرة اتسجّلت بالغلط (what = "unearly") */
export const devRestoreBooking = (bookingId, what) => rpc("dev_restore_booking", { p_booking: bookingId, p_what: what });

/* المطوّر: مسح نهائي لحجز أو يومية اتعملوا بالغلط (بعد ما تحصيلهم اتشال من اليوميات) */
export const devDeleteBooking = (bookingId) => rpc("dev_delete_booking", { p_booking: bookingId });
export const devDeleteShift = ({ hotelId, date, shiftKey }) => rpc("dev_delete_shift", { p_hotel: hotelId, p_date: date, p_key: shiftKey });

/* تسجيل سطور دفع على حجز: كل سطر بوسيلته (عملة الحجز = تحصيل عادي + رسوم فيزا، عملة تانية = سداد خدمات بالعملة دي). بترجع { done, errors } */
export async function recordPayLines(booking, lines, note = "تحصيل") {
  const done = [], errors = [];
  for (const l of lines) {
    const amount = Math.round((Number(l.amount) || 0) * 100) / 100;
    if (!(amount > 0)) continue;
    const label = `${amount} ${l.currency} ${l.method}`;
    const details = l.details || {};
    let r;
    // عملة الحجز = الليالي (والخدمات بنفس العملة)؛ عملة تانية = خدمات بالعملة دي (من غير سعر صرف)
    r = await recordAnyPayment(booking, { amount, currency: l.currency, method: l.method, details, note });
    if (r.error) { errors.push(`${label}: ${r.error}`); continue; }
    done.push(label);
    const fee = l.method === "فيزا" && l.currency === booking.currency ? Math.round((Number(l.fee) || 0) * 100) / 100 : 0;
    if (fee > 0) {
      const f = await recordVisaFee({ bookingId: booking.id, amount: fee, details });
      if (f.error) errors.push(`رسوم فيزا ${fee} ${l.currency}: ${f.error}`); else done.push(`رسوم فيزا ${fee} ${l.currency}`);
    }
  }
  return { done, errors };
}

/* التحقق من سطور الدفع قبل التسجيل: رسالة الخطأ أو null */
export function payLinesError(booking, lines, validate) {
  for (const l of lines) {
    const amount = Number(l.amount);
    if (l.amount === "" || l.amount == null) continue;
    if (!Number.isFinite(amount) || amount < 0) return "المبلغ لازم يكون رقم صحيح";
    if (amount === 0) continue;
    const err = validate(l.method, l.details); if (err) return err;
    if (Number(l.fee) < 0) return "رسوم الفيزا لازم تكون صفر أو أكتر";
  }
  return null;
}

/* دفعة بأي عملة: عملة الحجز = عادي؛ عملة عليها خدمات = خدمات العملة دي؛ غير كده (الجنيه أو عملة سعرها متحدد على الحجز)
   = بتتحوّل لعملة الحجز بسعر الحجز (القاعدة بتاخد السعر من الحجز نفسه) */
export async function recordAnyPayment(booking, { amount, currency, method, details, note = "تحصيل", expectedUpdatedAt = null }) {
  const req = { bookingId: booking.id, amount, method, details, note, expectedUpdatedAt };
  if (!currency || currency === booking.currency) return recordBookingPayment(req);
  if ((otherDue(booking)[currency] || 0) > 0) return recordBookingPaymentOther({ ...req, currency });
  if (bookingFxRate(booking, currency)) return recordBookingPaymentFx({ ...req, currency });
  return recordBookingPaymentOther({ ...req, currency });
}

/* تحديد سعر عملة بالمصري على الحجز (مرة واحدة - الدفعات القديمة بتفضل بسعرها) */
export const setBookingFxRate = ({ bookingId, currency, egp }) => rpc("set_booking_fx_rate", { p_booking: bookingId, p_currency: currency, p_egp: Number(egp) });

/* قبل تسجيل/تعديل دفعات: أي سعر عملة ناقص اتكتب جنب السطر (l.rates = { USD: "54" }) بيتحفظ على الحجز الأول.
   بترجّع { booking } بأسعاره الجديدة أو { error } */
export async function ensureLineRates(booking, lines) {
  let b = booking;
  for (const l of lines || []) {
    if (!(Number(l.amount) > 0)) continue;
    for (const c of fxRatesNeeded(b, l.currency)) {
      const v = Number(l.rates?.[c]);
      if (!(v > 0)) return { error: `اكتب سعر الـ ${c} بالمصري جنب الدفعة (مرة واحدة للحجز ده)` };
      const r = await setBookingFxRate({ bookingId: b.id, currency: c, egp: v });
      if (r.error) return { error: r.error };
      b = { ...b, fxRates: { ...(b.fxRates || {}), [c]: v } };
    }
  }
  return { booking: b };
}
