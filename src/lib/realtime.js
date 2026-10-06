import { supabase } from "./supabaseClient";

const WATCHED_TABLES = ["rooms", "room_overrides", "bookings", "shift_records", "shift_claims", "activity_log", "profiles"];

/*
  بث لحظي حقيقي: أي جهاز يعدّل أي جدول من الجداول دي، كل الأجهزة التانية المفتوحة
  على الموقع بتستقبل إشعار فورًا وتعمل إعادة تحميل - بكده الشاشات بتتزامن لحظيًا.
  onStatus (اختياري) بيستقبل حالة القناة (SUBSCRIBED / CHANNEL_ERROR / TIMED_OUT /
  CLOSED) عشان اللي بيستخدمها يعيد تحميل البيانات أول ما القناة ترجع تتوصل
  بعد أي انقطاع (أي تغييرات حصلت وقت الانقطاع ماكانتش هتوصل).
*/
export function subscribeToAllChanges(onChange, onStatus) {
  const channel = supabase.channel("calma_live_" + Math.random().toString(36).slice(2, 8));
  WATCHED_TABLES.forEach((table) => {
    channel.on("postgres_changes", { event: "*", schema: "public", table }, (payload) => onChange(table, payload));
  });
  channel.subscribe((status) => { if (onStatus) onStatus(status); });
  return () => { supabase.removeChannel(channel); };
}
