import { addDays } from "./dates";
import { bookingGrandTotal } from "./money";
import { MANUAL_STATUS_OPTIONS } from "./constants";

export function isOverrideStillActive(ov, dateStr) {
  if (!ov) return false;
  if (ov.status === "maintenance") return true; // الصيانة بتفضل لحد ما حد يشيلها يدويًا
  const d = new Date(ov.updatedAt);
  const setDateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return setDateStr === dateStr; // باقي الحالات صالحة ليوم واحد بس وبترجع تلقائي بعده
}

export function computeRoomStatus(roomNumber, bookings, overrides, dateStr) {
  const ov = overrides[roomNumber];
  if (ov && ov.status && ov.status !== "auto" && isOverrideStillActive(ov, dateStr)) {
    const opt = MANUAL_STATUS_OPTIONS.find((o) => o.key === ov.status);
    return { key: ov.status, label: opt ? opt.label : ov.status, source: "manual" };
  }
  const approved = bookings.filter((b) => b.approvalStatus !== "pending");
  const active = approved.find((b) => b.room === roomNumber && b.status !== "ملغي" && b.checkin <= dateStr && dateStr < b.checkout);
  if (active) {
    const gt = bookingGrandTotal(active);
    const paid = !!active.settled || (Number(active.amountPaid) || 0) >= gt;
    return { key: paid ? "occupied_paid" : "occupied_unpaid", label: paid ? "مشغولة - متحصّل بالكامل" : "مشغولة - متبقي عليها فلوس", guest: active.guestName, booking: active, paid };
  }
  const upcoming = approved.find((b) => b.room === roomNumber && b.status !== "ملغي" && b.checkin > dateStr && b.checkin <= addDays(dateStr, 2));
  if (upcoming) return { key: "reserved", label: "قادمة قريبًا", guest: upcoming.guestName, booking: upcoming };
  const pending = bookings.find((b) => b.room === roomNumber && b.approvalStatus === "pending" && b.status !== "ملغي" && b.checkin <= addDays(dateStr, 2) && dateStr < b.checkout);
  if (pending) return { key: "pending_approval", label: "حجز قيد الموافقة", guest: pending.guestName, booking: pending };
  return { key: "available", label: "متاحة" };
}

export function roomsOverlap(bookings, room, checkin, checkout, excludeId) {
  return bookings.some((b) => b.id !== excludeId && b.room === room && b.status !== "ملغي" && !(checkout <= b.checkin || checkin >= b.checkout));
}
