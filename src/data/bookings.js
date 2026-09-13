import { supabase } from "../lib/supabaseClient";

function bookingFromRow(r) {
  return {
    id: r.id, code: r.code || "", room: r.room, guestName: r.guest_name || "", phone: r.phone || "", pax: r.pax || 1,
    checkin: r.checkin, checkout: r.checkout, priceNight: Number(r.price_night) || 0, currency: r.currency,
    totalRoom: Number(r.total_room) || 0, extras: r.extras || { laundry: 0, cafeteria: 0, tours: 0, pickup: 0 },
    earlyCheckin: r.early_checkin || { applied: false, fee: 0, note: "" },
    paymentMethod: r.payment_method, paymentDetails: r.payment_details || { senderName: "", senderNumber: "", ref: "" },
    amountPaid: Number(r.amount_paid) || 0, amountTendered: Number(r.amount_tendered) || 0,
    source: r.source, status: r.status, approvalStatus: r.approval_status, settled: !!r.settled, notes: r.notes || "",
    imported: !!r.imported, needsRoomReview: !!r.needs_room_review, createdAt: new Date(r.created_at).getTime(),
  };
}

function bookingToRow(b) {
  return {
    code: b.code || null, room: b.room, guest_name: b.guestName, phone: b.phone, pax: Number(b.pax) || 1,
    checkin: b.checkin, checkout: b.checkout, price_night: Number(b.priceNight) || 0, currency: b.currency,
    total_room: Number(b.totalRoom) || 0, extras: b.extras || {}, early_checkin: b.earlyCheckin || { applied: false, fee: 0, note: "" },
    payment_method: b.paymentMethod, payment_details: b.paymentDetails || {},
    amount_paid: Number(b.amountPaid) || 0, amount_tendered: Number(b.amountTendered) || 0,
    source: b.source, status: b.status, approval_status: b.approvalStatus || "approved", settled: !!b.settled,
    notes: b.notes || "", imported: !!b.imported, needs_room_review: !!b.needsRoomReview,
  };
}

export async function getBookings() {
  const { data, error } = await supabase.from("bookings").select("*").order("checkin", { ascending: false });
  if (error || !data) return [];
  return data.map(bookingFromRow);
}

export async function insertBooking(booking) {
  const { data, error } = await supabase.from("bookings").insert(bookingToRow(booking)).select().maybeSingle();
  if (error) return { error: error.message };
  return { data: bookingFromRow(data) };
}

export async function updateBooking(id, booking) {
  const { data, error } = await supabase.from("bookings").update(bookingToRow(booking)).eq("id", id).select().maybeSingle();
  if (error) return { error: error.message };
  return { data: bookingFromRow(data) };
}

export async function deleteBooking(id) {
  const { error } = await supabase.from("bookings").delete().eq("id", id);
  return { error: error?.message };
}
