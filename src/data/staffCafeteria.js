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

