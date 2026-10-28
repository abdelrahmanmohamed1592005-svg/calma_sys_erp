import { supabase } from "../lib/supabaseClient";
import { isMissingFunctionError, OUTDATED_SCHEMA_MESSAGE } from "./schemaCheck";

/* تسجيل الفلوس بعملية واحدة ذرية في قاعدة البيانات (كله أو ولا حاجة): الحجز + صف الوسيلة في اليومية + كافيتيريا النزيل.
   التحقق (المبلغ ≤ المتبقي، الوسيلة، آخر ٤ أرقام الفيزا، رقم تليفون التحويل) بيتنفّذ في القاعدة نفسها كمان.
   انظر قسم ٣٣ في schema.sql. */

// خطأ شبكة (مفيش كود من الـ API): ممكن العملية تكون اتسجّلت فعلًا والرد بس هو اللي ضاع
const isNetworkError = (e) => !e.code && /fetch|network|timeout|load failed|aborted/i.test(e.message || "");
const UNCERTAIN_NOTE = " - مش متأكدين إن العملية اتسجّلت (النت قطع): راجع المدفوع/اليومية قبل ما تعيد التسجيل عشان ما يتكرّرش";

async function rpc(name, args) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) {
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

/* نقل النزيل (الحجز كله) لغرفة تانية فاضية في نفس التواريخ */
export const moveBookingRoom = ({ bookingId, room, expectedUpdatedAt }) =>
  rpc("move_booking_room", { p_booking: bookingId, p_room: Number(room), p_expected: expectedUpdatedAt || null });

/* تعديل عملة الحجز (الأرقام زي ما هي) - بتتغيّر في الحجز وفي صفوف اليومية المفتوحة بتاعته مع بعض */
export const changeBookingCurrency = ({ bookingId, currency, expectedUpdatedAt }) =>
  rpc("change_booking_currency", { p_booking: bookingId, p_currency: currency, p_expected: expectedUpdatedAt || null });

export const recordStaffCafeteria = ({ name, username, description, amount, currency, method, details }) =>
  rpc("record_staff_cafeteria", { p_name: name, p_username: username || null, p_desc: description || "", p_amount: amount, p_currency: currency, p_method: method || null, p_details: details || null });

export const settleStaffCafeteria = ({ name, username, currency, amount, method, details }) =>
  rpc("settle_staff_cafeteria", { p_name: name, p_username: username || null, p_currency: currency, p_amount: amount, p_method: method, p_details: details || {} });
