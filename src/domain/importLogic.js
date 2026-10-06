import { addDays, nightsBetween, parseDateFlexible, todayStr, uid } from "./dates";
import { roomsOverlap } from "./bookingLogic";

// قراءة قيمة عمود من صف مستورد بأي اسم من الأسماء المحتملة (من غير حساسية
// لحالة الحروف أو المسافات الزايدة)، وبترجع "" لو العمود مش موجود أو فاضي.
export function getField(row, keys) {
  const entries = Object.entries(row || {});
  for (const k of keys) {
    const hit = entries.find(([kk]) => kk.trim().toLowerCase() === k.toLowerCase());
    if (hit && String(hit[1] ?? "").trim() !== "") return String(hit[1]).trim();
  }
  return "";
}

// وسيلة الدفع المكتوبة في الملف المستورد -> أقرب وسيلة من PAYMENT_METHODS.
export function mapPaymentMethod(raw) {
  const s = String(raw || "").toLowerCase();
  if (s.includes("visa") || s.includes("فيزا") || s.includes("card")) return "فيزا";
  if (s.includes("insta") || s.includes("انستا") || s.includes("transfer") || s.includes("تحويل")) return "تحويل بنكي / انستاباي";
  if (s.includes("vodafone") || s.includes("فودافون")) return "فودافون كاش";
  return "كاش";
}

export function buildImportDraft(row, idx, rooms, existingBookings) {
  const code = getField(row, ["Code#", "Code", "Booking Code"]);
  const explicitRoom = Number(getField(row, ["Room #", "Room#", "Room"]));
  const priceNight = Number(getField(row, ["Price/Night ($)", "Price/Night", "Price"]).replace(/[^0-9.]/g, "")) || 0;
  let nights = Number(getField(row, ["Nights"])) || 0;
  const checkin = parseDateFlexible(getField(row, ["Check In", "Checkin"]));
  let checkout = parseDateFlexible(getField(row, ["Check Out", "Checkout"]));
  if (!checkout && checkin && nights) checkout = addDays(checkin, nights);
  if (checkin && checkout && !nights) nights = nightsBetween(checkin, checkout);
  const paymentMethod = mapPaymentMethod(getField(row, ["Payment Options", "Payment"]));
  const onlineRef = getField(row, ["Online Payment"]);
  const currency = getField(row, ["Currency"]) || "USD";
  const laundry = Number(getField(row, ["Laundry ($)", "Laundry"])) || 0;
  const cafeteria = Number(getField(row, ["Cafeteria ($)", "Cafeteria"])) || 0;
  const tours = Number(getField(row, ["Tours ($)", "Tours"])) || 0;
  const pickup = Number(getField(row, ["Pickup ($)", "Pickup"])) || 0;
  const amountTendered = Number(getField(row, ["Amount Tendered"])) || 0;
  const totalRoom = Number(getField(row, ["Total Room ($)", "Total Room"])) || priceNight * nights;
  const settled = getField(row, ["Clear"]) !== "";
  const source = getField(row, ["Source"]) || "Booking.com";

  let room = "", matched = "none";
  if (explicitRoom && rooms.some((r) => r.number === explicitRoom)) { room = explicitRoom; matched = "explicit"; }
  else if (checkin && checkout) {
    const free = rooms.filter((r) => !roomsOverlap(existingBookings, r.number, checkin, checkout));
    if (free.length) {
      const sorted = [...free].sort((a, b) => Math.abs(a.price - priceNight) - Math.abs(b.price - priceNight) || a.number - b.number);
      room = sorted[0].number; matched = "auto";
    }
  }

  return {
    id: uid(), code, room, guestName: code ? `نزيل - ${code}` : `نزيل مستورد ${idx + 1}`, phone: "", pax: 1,
    checkin: checkin || todayStr(), checkout: checkout || addDays(todayStr(), 1),
    priceNight, currency, totalRoom, extras: { laundry, cafeteria, tours, pickup },
    earlyCheckin: { applied: false, fee: 0, note: "" },
    paymentMethod, paymentDetails: { senderName: "", senderNumber: "", ref: onlineRef },
    amountPaid: totalRoom, amountTendered,
    source, status: "مؤكد", approvalStatus: "approved", settled, notes: "",
    imported: true, needsRoomReview: matched !== "explicit" || !room, excluded: false,
  };
}
