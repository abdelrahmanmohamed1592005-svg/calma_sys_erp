import { supabase } from "../lib/supabaseClient";

/* الفنادق: الجروب فيه أكتر من فندق، وكل فندق ليه بروفايل مستقل (غرفه، حجوزاته، يوميته، كافيتيريته، تقاريره).
   الموظفين والمستخدمين مشتركين على مستوى الجروب. أرقام الغرف فريدة على مستوى الجروب فرقم الغرفة بيحدد الفندق. */

export const DEFAULT_HOTELS = [{ id: 1, name: "فندق Calma", shortName: "Calma", active: true }];

export async function getHotels() {
  const { data, error } = await supabase.from("hotels").select("*").order("sort_order").order("id");
  if (error || !data || !data.length) return null;
  return data.map((h) => ({ id: h.id, name: h.name, shortName: h.short_name || h.name, active: h.active !== false }));
}

/* "الفندق الشغال" على مستوى الواجهة كلها: كل قراءة/كتابة لليومية والاختيارات وكافيتيريا الاستاف بتتعمل على الفندق ده
   (الواجهة بتغيّره من مبدّل الفنادق في الهيدر، وبتعمل إعادة تحميل كاملة للشاشات بعدها). */
let activeHotelId = 1;
export function setActiveHotelId(id) { activeHotelId = Number(id) || 1; }
export function getActiveHotelId() { return activeHotelId; }
/* hotelId صريح (رقم) أو "all" (كل الفنادق - للتقارير المجمّعة) أو undefined (الفندق الشغال) */
export function resolveHotelScope(hotelId) { return hotelId === "all" ? null : (hotelId == null ? activeHotelId : Number(hotelId)); }
