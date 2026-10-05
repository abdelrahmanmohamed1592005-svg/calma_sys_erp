import { supabase } from "../lib/supabaseClient";

// الغرفة بقت بس رقمها واسمها - كل تفاصيلها التانية (السعر، العملة، النوع،
// إلخ) بقت بتتحدد من الحجز نفسه مش من بيانات الغرفة الثابتة (انظر
// domain/constants.js).
function roomFromRow(r) {
  return { number: r.number, name: r.name || "" };
}

export async function getRooms() {
  const { data, error } = await supabase.from("rooms").select("*").order("number");
  if (error || !data) return [];
  return data.map(roomFromRow);
}

export async function getRoomOverrides() {
  const { data, error } = await supabase.from("room_overrides").select("*");
  if (error || !data) return {};
  const map = {};
  data.forEach((r) => { map[r.room_number] = { status: r.status, updatedAt: new Date(r.updated_at).getTime(), updatedBy: r.updated_by }; });
  return map;
}

export async function setRoomOverride(roomNumber, status, updatedBy) {
  const { error } = await supabase.from("room_overrides").upsert({
    room_number: roomNumber, status, updated_at: new Date().toISOString(), updated_by: updatedBy || null,
  });
  return { error: error?.message };
}
