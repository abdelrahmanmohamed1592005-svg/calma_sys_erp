import { supabase } from "../lib/supabaseClient";

function roomFromRow(r) {
  return { number: r.number, type: r.type, price: Number(r.price), currency: r.currency, capacity: r.capacity, beds: r.beds || "" };
}

export async function getRooms() {
  const { data, error } = await supabase.from("rooms").select("*").order("number");
  if (error || !data) return [];
  return data.map(roomFromRow);
}

export async function saveRoom(room) {
  const { error } = await supabase.from("rooms").update({
    type: room.type, price: room.price, currency: room.currency, capacity: room.capacity, beds: room.beds,
  }).eq("number", room.number);
  return { error: error?.message };
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
