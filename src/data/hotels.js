import { supabase } from "../lib/supabaseClient";

/* الفنادق: الجروب فيه أكتر من فندق، وكل فندق ليه بروفايل مستقل (غرفه، حجوزاته، يوميته، كافيتيريته، تقاريره).
   الموظفين والمستخدمين مشتركين على مستوى الجروب. أرقام الغرف فريدة على مستوى الجروب فرقم الغرفة بيحدد الفندق. */

export const DEFAULT_HOTELS = [{ id: 1, name: "فندق Calma", shortName: "Calma", active: true }];

export async function getHotels() {
  const { data, error } = await supabase.from("hotels").select("*").order("sort_order").order("id");
  if (error || !data || !data.length) return null;
  return data.map((h) => ({ id: h.id, name: h.name, shortName: h.short_name || h.name, prefix: h.code_prefix || "B", active: h.active !== false }));
}

export { setActiveHotelId, getActiveHotelId, resolveHotelScope } from "./hotelScope";

/* إدارة الفنادق والغرف (المدير العام بس - القاعدة بتفرض ده): كل العمليات دوال في قاعدة البيانات، ومفيش مسح لفندق أو غرفة */
export async function createHotel({ name, shortName, prefix }) {
  const { data, error } = await supabase.rpc("create_hotel", { p_name: name, p_short: shortName || null, p_prefix: prefix || null });
  return error ? { error: error.message } : { id: data };
}
export async function updateHotel(id, patch) {
  const row = {};
  if (patch.name !== undefined) row.name = patch.name;
  if (patch.shortName !== undefined) row.short_name = patch.shortName || null;
  if (patch.active !== undefined) row.active = !!patch.active;
  if (patch.prefix !== undefined) row.code_prefix = String(patch.prefix).toUpperCase();
  const { data, error } = await supabase.from("hotels").update(row).eq("id", id).select("id");
  if (error) return { error: error.message };
  if (!data || !data.length) return { error: "تعذر الحفظ - مالكش صلاحية أو الفندق مش موجود" };
  return {};
}
export async function addHotelRoom(hotelId, number, name) {
  const { error } = await supabase.rpc("add_hotel_room", { p_hotel: hotelId, p_number: Number(number), p_name: name || null });
  return { error: error?.message };
}
export async function renameHotelRoom(number, name) {
  const { error } = await supabase.rpc("rename_hotel_room", { p_number: number, p_name: name });
  return { error: error?.message };
}
/* الفنادق المسموحة لموظف (null = كل الفنادق) */
export async function setProfileHotels(profileId, hotelIds) {
  const { data, error } = await supabase.from("profiles").update({ allowed_hotels: hotelIds && hotelIds.length ? hotelIds : null }).eq("id", profileId).select("id");
  if (error) return { error: error.message };
  if (!data || !data.length) return { error: "تعذر الحفظ - مالكش صلاحية" };
  return {};
}
