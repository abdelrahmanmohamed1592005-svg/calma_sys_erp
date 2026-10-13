import { supabase } from "../lib/supabaseClient";
import { isMissingFunctionError, OUTDATED_SCHEMA_MESSAGE } from "./schemaCheck";

/* تسجيل الفلوس بعملية واحدة ذرية في قاعدة البيانات (كله أو ولا حاجة): الحجز + صف الوسيلة في اليومية + كافيتيريا النزيل.
   التحقق (المبلغ ≤ المتبقي، الوسيلة، آخر ٤ أرقام الفيزا، رقم تليفون التحويل) بيتنفّذ في القاعدة نفسها كمان.
   انظر قسم ٣٣ في schema.sql. */

async function rpc(name, args) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) return { error: isMissingFunctionError(error) ? OUTDATED_SCHEMA_MESSAGE + " (" + name + ")" : error.message };
  return { data };
}

export const recordBookingPayment = ({ bookingId, amount, method, details, note }) =>
  rpc("record_booking_payment", { p_booking: bookingId, p_amount: amount, p_method: method, p_details: details || {}, p_expected: null, p_note: note || "تحصيل" });

export const recordStaffCafeteria = ({ name, username, description, amount, currency, method, details }) =>
  rpc("record_staff_cafeteria", { p_name: name, p_username: username || null, p_desc: description || "", p_amount: amount, p_currency: currency, p_method: method || null, p_details: details || null });

export const settleStaffCafeteria = ({ name, username, currency, amount, method, details }) =>
  rpc("settle_staff_cafeteria", { p_name: name, p_username: username || null, p_currency: currency, p_amount: amount, p_method: method, p_details: details || {} });
