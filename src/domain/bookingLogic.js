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

/* تصنيف صف مستورد مقابل الحجوزات الموجودة:
   - نفس الكود -> تحديث لنفس الحجز (حتى لو المدة اتغيرت / اتمددت)
   - مفيش كود بس نفس الغرفة+نفس تاريخ الدخول والخروج بالظبط -> تكرار لنفس الرفعة -> تحديث في مكانه
   - نفس الغرفة وتواريخ متداخلة لكن مش نفس الحجز -> تعارض حقيقي، تحت المراجعة ولا يتضاف تلقائيًا
   - حجز لسه بانتظار موافقة مدير الحجوزات مينفعش الاستيراد "يبلعه" ويحدثه/يمسح تفاصيله */
export function classifyBookingAgainstSet(draft, workingBookings) {
  if (draft.code) {
    const m = workingBookings.find((b) => b.code && b.code === draft.code && b.approvalStatus !== "pending");
    if (m) return { matchType: "update", matchedExistingId: m.id };
  }
  const exact = workingBookings.find((b) => b.room === draft.room && b.checkin === draft.checkin && b.checkout === draft.checkout && b.status !== "ملغي" && b.approvalStatus !== "pending");
  if (exact) return { matchType: "update", matchedExistingId: exact.id };
  const conflict = workingBookings.find((b) => b.room === draft.room && b.status !== "ملغي" && !(draft.checkout <= b.checkin || draft.checkin >= b.checkout));
  if (conflict) return { matchType: "conflict", matchedExistingId: conflict.id };
  return { matchType: "new", matchedExistingId: null };
}

export function getField(row, keys) {
  const entries = Object.entries(row);
  for (const k of keys) {
    const hit = entries.find(([kk]) => kk.trim().toLowerCase() === k.toLowerCase());
    if (hit && String(hit[1]).trim() !== "") return String(hit[1]).trim();
  }
  return "";
}

export function mapPaymentMethod(raw) {
  const s = (raw || "").toLowerCase();
  if (s.includes("visa") || s.includes("فيزا") || s.includes("card")) return "فيزا";
  if (s.includes("insta") || s.includes("انستا")) return "انستاباي";
  if (s.includes("vodafone") || s.includes("فودافون")) return "فودافون كاش";
  if (s.includes("transfer") || s.includes("تحويل")) return "تحويل بنكي";
  return "كاش";
}
