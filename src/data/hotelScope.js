/* "الفندق الشغال" على مستوى الواجهة كلها: كل قراءة/كتابة لليومية والاختيارات وكافيتيريا الاستاف بتتعمل على الفندق ده
   (الواجهة بتغيّره من شريط الفنادق، وبتعمل إعادة تحميل كاملة للشاشات بعدها).
   الملف ده من غير أي imports (مفيش Supabase) عشان اختباراته تشتغل على أي نسخة Node (CI على Node 20 مافيهوش WebSocket). */
let activeHotelId = 1;
export function setActiveHotelId(id) { activeHotelId = Number(id) || 1; }
export function getActiveHotelId() { return activeHotelId; }
/* hotelId صريح (رقم) أو "all" (كل الفنادق - للتقارير المجمّعة) أو undefined (الفندق الشغال) */
export function resolveHotelScope(hotelId) { return hotelId === "all" ? null : (hotelId == null ? activeHotelId : Number(hotelId)); }
