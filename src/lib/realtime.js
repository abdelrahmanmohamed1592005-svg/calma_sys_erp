import { supabase } from "./supabaseClient";

const WATCHED_TABLES = ["rooms", "room_overrides", "bookings", "shift_records", "shift_claims", "activity_log", "profiles"];

/*
  بث لحظي حقيقي: أي جهاز يعدّل أي جدول من الجداول دي، كل الأجهزة التانية المفتوحة
  على الموقع بتستقبل إشعار فورًا وتعمل إعادة تحميل - بكده الشاشات بتتزامن لحظيًا.
*/
export function subscribeToAllChanges(onChange) {
  const channel = supabase.channel("calma_live");
  WATCHED_TABLES.forEach((table) => {
    channel.on("postgres_changes", { event: "*", schema: "public", table }, (payload) => onChange(table, payload));
  });
  channel.subscribe();
  return () => supabase.removeChannel(channel);
}
