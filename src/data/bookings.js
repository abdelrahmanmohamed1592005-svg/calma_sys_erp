import { supabase } from "../lib/supabaseClient";

function bookingFromRow(r) {
  return {
    id: r.id, code: r.code || "", room: r.room, guestName: r.guest_name || "", phone: r.phone || "", pax: r.pax || 1,
    checkin: r.checkin, checkout: r.checkout, priceNight: Number(r.price_night) || 0, currency: r.currency,
    totalRoom: Number(r.total_room) || 0, extras: r.extras || { laundry: 0, cafeteria: 0, tours: 0, pickup: 0 },
    earlyCheckin: r.early_checkin || { applied: false, fee: 0, note: "" },
    guestCodes: Array.isArray(r.guest_codes) ? r.guest_codes.map((c) => String(c ?? "")) : [],
    paymentMethod: r.payment_method, paymentDetails: r.payment_details || { senderName: "", senderNumber: "", ref: "", onlinePaid: false },
    amountPaid: Number(r.amount_paid) || 0, amountTendered: Number(r.amount_tendered) || 0,
    source: r.source, status: r.status, approvalStatus: r.approval_status, settled: !!r.settled, notes: r.notes || "",
    imported: !!r.imported, needsRoomReview: !!r.needs_room_review, createdAt: new Date(r.created_at).getTime(),
    // createdBy بيبان في سجل النشاط/التدقيق مين أنشأ الحجز فعليًا (القيمة
    // دي بتتملى تلقائيًا في قاعدة البيانات، مينفعش حد يزوّرها). updatedAt
    // لازم عشان نقدر نمنع تعديلين في نفس اللحظة يبوّظوا بعض (انظر
    // updateBookingIfUnchanged تحت).
    createdBy: r.created_by || null, createdByRole: r.created_by_role || null, updatedAt: r.updated_at,
    // leftEarly: الحجز ده اختصر (مشي بدري) لإفساح الغرفة لتسكين مكرر جديد.
    // duplicatePlacement: الحجز ده هو التسكين المكرر اللي حل مكان حجز قديم.
    // الاتنين بدائل عن استخدام status="ملغي" غلط في عملية تسكين مكرر تلقائية
    // (انظر قسم ١٨ في schema.sql) - "ملغي" الحقيقي يفضل فعل يدوي من مدير الحجوزات بس.
    leftEarly: !!r.left_early, duplicatePlacement: !!r.duplicate_placement,
    // refundPending: الحجز اتلغى وكان عليه مبلغ متحصّل لسه لازم يترد للنزيل
    // - بيتحدد تلقائيًا في قاعدة البيانات نفسها لحظة ما الحالة تتغيّر لـ
    // "ملغي" (انظر قسم ٢١ في schema.sql)، وبيُتصفّر لحظة ما موظف الشيفت يسجّل
    // رد الفلوس فعليًا (processRefund في BookingsPanel.jsx).
    refundPending: !!r.refund_pending, refundedAmount: r.refunded_amount != null ? Number(r.refunded_amount) : null,
    refundedBy: r.refunded_by || null, refundedAt: r.refunded_at ? new Date(r.refunded_at).getTime() : null,
    refundDecision: r.refund_decision || null, // "refunded" | "kept" | null
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
    left_early: !!b.leftEarly, duplicate_placement: !!b.duplicatePlacement,
    guest_codes: Array.isArray(b.guestCodes) ? b.guestCodes : [],
    // حقول رد الفلوس (refund_*) مش بتتبعت من الواجهة خالص: طلب الرد بيتفتح
    // تلقائيًا في قاعدة البيانات، وقراره (رد/إبقاء) بيتم بس عن طريق
    // decideBookingRefund تحت (مدير الحجوزات بس).
  };
}

// الطلب نجح من غير ما يرجع أي صف (مثلاً الحجز اتحذف من جهاز تاني أو الصلاحية
// مش مسموحة له) - بدل ما bookingFromRow(null) يرمي TypeError ويوقع الشاشة.
const NO_ROW_ERROR = "تعذر حفظ الحجز - ممكن يكون اتحذف أو مالكش صلاحية عليه، حدّث الصفحة وراجع الحجوزات";

/* رسالة خطأ مفهومة بدل نص قاعدة البيانات التقني. أهمها قيد منع الحجز
   المزدوج (exclusion_violation، كود 23P01): معناه إن فيه حجز تاني فعلاً على
   نفس الغرفة في تواريخ متداخلة (غالبًا اتضاف من جهاز تاني في نفس اللحظة). */
export function friendlyBookingError(error) {
  if (!error) return null;
  if (error.code === "23P01" || /bookings_no_overlap/.test(error.message || "")) {
    return "الغرفة دي اتحجزت لحد تاني في تواريخ متداخلة (غالبًا من جهاز تاني دلوقتي) - البيانات اتحدّثت، راجع الحجوزات الأول";
  }
  return error.message;
}

// بترجع null (مش قايمة فاضية) لو القراءة فشلت، عشان الشاشة تفضل على آخر
// بيانات سليمة بدل ما "تفضى" فجأة ويتعتبر مفيش حجوزات خالص (وده كان هيخلّي
// فحص التعارض يعدّي غلط) - انظر App.jsx.
export async function getBookings() {
  const { data, error } = await supabase.from("bookings").select("*").order("checkin", { ascending: false });
  if (error || !data) return null;
  return data.map(bookingFromRow);
}

export async function insertBooking(booking) {
  const { data, error } = await supabase.from("bookings").insert(bookingToRow(booking)).select().maybeSingle();
  if (error) return { error: friendlyBookingError(error), code: error.code };
  if (!data) return { error: NO_ROW_ERROR };
  return { data: bookingFromRow(data) };
}

export async function updateBooking(id, booking) {
  const { data, error } = await supabase.from("bookings").update(bookingToRow(booking)).eq("id", id).select().maybeSingle();
  if (error) return { error: friendlyBookingError(error), code: error.code };
  if (!data) return { error: NO_ROW_ERROR };
  return { data: bookingFromRow(data) };
}

/* كتابة آمنة من التعارض - نفس أسلوب updateShiftRecordIfUnchanged بالظبط:
   لو حد تاني (موظف تاني في نفس الشيفت، أو تاب تاني مفتوح) عدّل نفس الحجز
   في نفس اللحظة، الـ updated_at هيكون اتغيّر، فشرط eq("updated_at", ...)
   مش هيتحقق ومفيش صف هيتحدث - وده اكتشاف التعارض بدل ما نكتب فوق تعديل
   حد تاني من غير ما حد يدري (مثلاً موظفة بتسجل تحصيل فيزا على غرفة في نفس
   لحظة ما مدير الحجوزات بيعدّل رقم تليفون النزيل على نفس الحجز). */
export async function updateBookingIfUnchanged(id, expectedUpdatedAt, booking) {
  if (!expectedUpdatedAt) return updateBooking(id, booking);
  const { data, error } = await supabase
    .from("bookings")
    .update(bookingToRow(booking))
    .eq("id", id).eq("updated_at", expectedUpdatedAt)
    .select().maybeSingle();
  if (error) return { error: friendlyBookingError(error), code: error.code };
  if (!data) return { conflict: true };
  return { data: bookingFromRow(data) };
}

/* قرار مدير الحجوزات في طلب رد فلوس: decision = "refund" (رد فعلي - بيتشال
   من المدفوع وبيتسجل بالسالب في يومية الشيفت المفتوح) أو "keep" (رفض الرد
   والفلوس تفضل متحصّلة). كله معاملة واحدة في قاعدة البيانات (decide_booking_refund). */
export async function decideBookingRefund(id, decision, expectedUpdatedAt, method) {
  const { data, error } = await supabase.rpc("decide_booking_refund", { p_booking: id, p_decision: decision, p_expected: expectedUpdatedAt || null, p_method: method || null });
  if (error) return { error: error.message };
  return { data };
}

export async function deleteBooking(id) {
  const { error } = await supabase.from("bookings").delete().eq("id", id);
  return { error: error?.message };
}
