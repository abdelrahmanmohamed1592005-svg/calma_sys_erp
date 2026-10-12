import { supabase } from "../lib/supabaseClient";
import { fetchAll } from "./page";
import { uid } from "../domain/dates";

/* كافيتيريا الاستاف: استهلاك موظفين (مشروبات/أكل) من الكافيتيريا، مين دفع ومين
   لسه عليه فلوس. المديونية بتفضل مفتوحة (حتى عبر الشيفتات) لحد ما تتسدّد.
   اللي بيتسجّل في اليومية هو السداد بس (الفلوس اللي دخلت فعلاً)، مش الاستهلاك. */

function fromRow(r) {
  return {
    id: r.id, day: r.day, shiftKey: r.shift_key, consumerUsername: r.consumer_username || null, consumerName: r.consumer_name,
    description: r.description || "", amount: Number(r.amount) || 0, currency: r.currency, paidAmount: Number(r.paid_amount) || 0,
    payments: Array.isArray(r.payments) ? r.payments : [], recordedBy: r.recorded_by || null, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

export const staffOwed = (e) => Math.max(0, (Number(e.amount) || 0) - (Number(e.paidAmount) || 0));

/* كل استهلاك الاستاف (الأحدث أولاً). بترجّع null لو القراءة فشلت (مش قايمة فاضية مضلّلة). */
export async function listStaffCafeteria() {
  const { data, error } = await fetchAll(() => supabase.from("staff_cafeteria").select("*", { count: "exact" }).order("created_at", { ascending: false }).order("id"));
  if (error || !data) return null;
  return data.map(fromRow);
}

/* تسجيل استهلاك جديد. paid (اختياري) = دفعة فورية { amount, method, details, shiftKey, date } */
export async function insertStaffCafeteria({ day, shiftKey, consumerUsername, consumerName, description, amount, currency, paid }) {
  const paidAmount = paid ? Number(paid.amount) || 0 : 0;
  const payments = paid && paidAmount > 0 ? [{ id: uid(), at: Date.now(), amount: paidAmount, method: paid.method, details: paid.details || null, shiftKey, day }] : [];
  const { data, error } = await supabase.from("staff_cafeteria").insert({
    day, shift_key: shiftKey, consumer_username: consumerUsername || null, consumer_name: consumerName, description: description || "",
    amount, currency, paid_amount: paidAmount, payments,
  }).select().maybeSingle();
  if (error) return { error: error.message };
  if (!data) return { error: "تعذر تسجيل الاستهلاك" };
  return { data: fromRow(data) };
}

/* سداد (كامل أو جزئي) على استهلاك موجود - مشروط بإن الصف ماتغيّرش (تعارض). */
export async function payStaffCafeteria(entry, payment) {
  const amt = Number(payment.amount) || 0;
  const payments = [...(entry.payments || []), { id: uid(), at: Date.now(), amount: amt, method: payment.method, details: payment.details || null, shiftKey: payment.shiftKey, day: payment.day }];
  const { data, error } = await supabase.from("staff_cafeteria")
    .update({ paid_amount: (Number(entry.paidAmount) || 0) + amt, payments })
    .eq("id", entry.id).eq("updated_at", entry.updatedAt)
    .select().maybeSingle();
  if (error) return { error: error.message };
  if (!data) return { conflict: true };
  return { data: fromRow(data) };
}

export async function deleteStaffCafeteria(id) {
  const { error, data } = await supabase.from("staff_cafeteria").delete().eq("id", id).select("id");
  if (error) return { error: error.message };
  if (!data || !data.length) return { error: "تعذر الحذف - مفيش صلاحية أو السجل اتحذف" };
  return {};
}
