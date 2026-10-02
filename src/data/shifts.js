import { supabase } from "../lib/supabaseClient";

function shiftFromRow(r) {
  return {
    date: r.date, shiftKey: r.shift_key, staffName: r.staff_name, staffUsername: r.staff_username,
    handover: r.handover || { EGP: 0, USD: 0 }, methodHandover: r.method_handover || {}, rows: r.rows || [], cafeteria: r.cafeteria || {},
    shiftNotes: r.shift_notes || "", flagged: !!r.flagged, closed: !!r.closed, closedBy: r.closed_by,
    closedAt: r.closed_at ? new Date(r.closed_at).getTime() : null,
    totalExpenses: r.total_expenses, totalCollections: r.total_collections, closingCash: r.closing_cash,
    // دي بتتحفظ بس وقت إقفال الشيفت (عشان تفضل ثابتة وتتقرأ في التقرير حتى
    // بعد ما تقفل)؛ للشيفت المفتوح بيتم حسابها لايف بـ computeShiftTotals.
    cashCollections: r.cash_collections, byMethodCurrency: r.by_method_currency, byCategory: r.by_category, methodClosing: r.method_closing,
    updatedAt: r.updated_at,
  };
}

function shiftToRow(rec) {
  return {
    date: rec.date, shift_key: rec.shiftKey, staff_name: rec.staffName, staff_username: rec.staffUsername,
    handover: rec.handover, method_handover: rec.methodHandover, rows: rec.rows, cafeteria: rec.cafeteria, shift_notes: rec.shiftNotes,
    flagged: rec.flagged, closed: rec.closed, closed_by: rec.closedBy,
    closed_at: rec.closedAt ? new Date(rec.closedAt).toISOString() : null,
    total_expenses: rec.totalExpenses || null, total_collections: rec.totalCollections || null, closing_cash: rec.closingCash || null,
    cash_collections: rec.cashCollections || null, by_method_currency: rec.byMethodCurrency || null, by_category: rec.byCategory || null, method_closing: rec.methodClosing || null,
  };
}

export async function getShiftRecord(date, shiftKey) {
  const { data, error } = await supabase.from("shift_records").select("*").eq("date", date).eq("shift_key", shiftKey).maybeSingle();
  if (error || !data) return null;
  return shiftFromRow(data);
}

export async function createShiftRecord(rec) {
  const { data, error } = await supabase.from("shift_records").insert(shiftToRow(rec)).select().maybeSingle();
  if (error) return { error: error.message };
  return { data: shiftFromRow(data) };
}

/* كتابة آمنة من التعارض: بتبعت آخر updated_at شفناه، ولو حد تاني عدّل السجل في نفس اللحظة
   (يعني الـ updated_at اتغيّر)، الشرط في WHERE مش بيتحقق فمفيش صفوف تتحدث - وده اكتشاف
   التعارض من غير ما نحتاج قفل قاعدة بيانات منفصل. */
export async function updateShiftRecordIfUnchanged(date, shiftKey, expectedUpdatedAt, patch) {
  const { data, error } = await supabase
    .from("shift_records")
    .update(shiftToRow(patch))
    .eq("date", date).eq("shift_key", shiftKey).eq("updated_at", expectedUpdatedAt)
    .select().maybeSingle();
  if (error) return { error: error.message };
  if (!data) return { conflict: true };
  return { data: shiftFromRow(data) };
}

export async function getClaimsForDate(date) {
  const { data, error } = await supabase.from("shift_claims").select("*").eq("date", date);
  if (error || !data) return {};
  const map = {};
  data.forEach((c) => { map[c.shift_key] = { username: c.username, name: c.name, claimedAt: new Date(c.claimed_at).getTime() }; });
  return map;
}

/* الحجز على مفتاح (date, shift_key) في الجدول بيمنع تلقائيًا حد تاني ياخد نفس الشيفت
   نفس اليوم - لو حد سبقك، الـ insert هيفشل بخطأ "duplicate key" بدل ما يتكتب فوقه. */
export async function claimShiftRow(date, shiftKey, username, name) {
  const { error } = await supabase.from("shift_claims").insert({ date, shift_key: shiftKey, username, name });
  if (error) {
    if (error.code === "23505") return { conflict: true }; // unique_violation
    return { error: error.message };
  }
  return { success: true };
}

export async function clearClaimRow(date, shiftKey) {
  const { error } = await supabase.from("shift_claims").delete().eq("date", date).eq("shift_key", shiftKey);
  return { error: error?.message };
}
