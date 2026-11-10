import { supabase } from "../lib/supabaseClient";
import { fetchAll } from "./page";
import { friendlyDbError } from "./schemaCheck";
import { shiftDayNow, addDays, isShiftActiveNow } from "../domain/dates";
import { getActiveHotelId, resolveHotelScope } from "./hotels";

/* القراءات/الكتابات على سجل واحد لازم تكون على فندق واحد: نطاق "all" هنا غلط برمجي فنرميه بدل ما نقع على الفندق الشغال بصمت */
function oneHotel(hotelId) {
  const h = resolveHotelScope(hotelId);
  if (h == null) throw new Error("نطاق كل الفنادق مش مدعوم في العملية دي");
  return h;
}

function shiftFromRow(r) {
  return {
    hotelId: r.hotel_id ?? 1, date: r.date, shiftKey: r.shift_key, staffName: r.staff_name, staffUsername: r.staff_username, helpers: r.helpers || [],
    handover: r.handover || { EGP: 0, USD: 0 }, methodHandover: r.method_handover || {}, rows: r.rows || [], cafeteria: r.cafeteria || {}, hotelRows: r.hotel_rows || [], cafeteriaRows: r.cafeteria_rows || [],
    bookingCollections: r.booking_collections || [],
    shiftNotes: r.shift_notes || "", flagged: !!r.flagged, closed: !!r.closed, closedBy: r.closed_by,
    closedAt: r.closed_at ? new Date(r.closed_at).getTime() : null,
    totalExpenses: r.total_expenses, totalCollections: r.total_collections, closingCash: r.closing_cash,
    // دي بتتحفظ بس وقت إقفال الشيفت (عشان تفضل ثابتة وتتقرأ في التقرير حتى
    // بعد ما تقفل)؛ للشيفت المفتوح بيتم حسابها لايف بـ computeShiftTotals.
    cashCollections: r.cash_collections, byMethodCurrency: r.by_method_currency, byCategory: r.by_category, methodClosing: r.method_closing,
    updatedAt: r.updated_at,
  };
}

function shiftToRow(rec) {
  return {
    hotel_id: rec.hotelId ?? getActiveHotelId(), date: rec.date, shift_key: rec.shiftKey, staff_name: rec.staffName, staff_username: rec.staffUsername,
    handover: rec.handover, method_handover: rec.methodHandover, rows: rec.rows, cafeteria: rec.cafeteria, hotel_rows: rec.hotelRows || [], cafeteria_rows: rec.cafeteriaRows || [],
    booking_collections: rec.bookingCollections || [], shift_notes: rec.shiftNotes,
    flagged: rec.flagged, closed: rec.closed, closed_by: rec.closedBy,
    closed_at: rec.closedAt ? new Date(rec.closedAt).toISOString() : null,
    total_expenses: rec.totalExpenses || null, total_collections: rec.totalCollections || null, closing_cash: rec.closingCash || null,
    cash_collections: rec.cashCollections || null, by_method_currency: rec.byMethodCurrency || null, by_category: rec.byCategory || null, method_closing: rec.methodClosing || null,
  };
}

export async function getShiftRecord(date, shiftKey, hotelId) {
  const { data, error } = await supabase.from("shift_records").select("*").eq("hotel_id", oneHotel(hotelId)).eq("date", date).eq("shift_key", shiftKey).maybeSingle();
  if (error || !data) return null;
  return shiftFromRow(data);
}

/* زي getShiftRecord بس بتفرّق بين "مفيش سجل" (data = null) و"القراءة فشلت" (error): قراءة فاشلة (نت وقع لحظة) ما تتعاملش كأن
   اليومية مش موجودة - وإلا كان هيتعمل سجل جديد برصيد افتتاحي صفر وتتكتب فوق عهدة الشيفت اللي قبله. */
export async function getShiftRecordStrict(date, shiftKey, hotelId) {
  const { data, error } = await supabase.from("shift_records").select("*").eq("hotel_id", oneHotel(hotelId)).eq("date", date).eq("shift_key", shiftKey).maybeSingle();
  if (error) return { error: friendlyDbError(error) };
  return { data: data ? shiftFromRow(data) : null };
}

export async function createShiftRecord(rec) {
  const { data, error } = await supabase.from("shift_records").insert(shiftToRow(rec)).select().maybeSingle();
  if (error) return { error: friendlyDbError(error) };
  if (!data) return { error: "تعذر إنشاء يومية الشيفت" };
  return { data: shiftFromRow(data) };
}

/* كتابة آمنة من التعارض: بتبعت آخر updated_at شفناه، ولو حد تاني عدّل السجل في نفس اللحظة
   (يعني الـ updated_at اتغيّر)، الشرط في WHERE مش بيتحقق فمفيش صفوف تتحدث - وده اكتشاف
   التعارض من غير ما نحتاج قفل قاعدة بيانات منفصل. */
export async function updateShiftRecordIfUnchanged(date, shiftKey, expectedUpdatedAt, patch) {
  const { data, error } = await supabase
    .from("shift_records")
    .update(shiftToRow(patch))
    .eq("hotel_id", patch.hotelId ?? getActiveHotelId()).eq("date", date).eq("shift_key", shiftKey).eq("updated_at", expectedUpdatedAt)
    .select().maybeSingle();
  if (error) return { error: friendlyDbError(error) };
  if (!data) return { conflict: true };
  return { data: shiftFromRow(data) };
}

/* كل سجلات اليومية في فترة (استعلام واحد بدل استعلام لكل شيفت في كل يوم -
   تقرير فترة سنة كان بيبعت أكتر من ١٠٠٠ طلب). بترجع null لو القراءة فشلت. */
export async function getShiftRecordsInRange(fromDate, toDate, hotelId) {
  const h = resolveHotelScope(hotelId);
  const { data, error } = await fetchAll(() => {
    const q = supabase.from("shift_records").select("*", { count: "exact" }).gte("date", fromDate).lte("date", toDate);
    return (h == null ? q : q.eq("hotel_id", h)).order("date", { ascending: true }).order("hotel_id").order("shift_key");
  }, 1000, (r) => `${r.hotel_id}|${r.date}|${r.shift_key}`);
  if (error || !data) return null;
  const order = { morning: 0, evening: 1, night: 2 };
  return data.map(shiftFromRow).sort((a, b) => (a.date === b.date ? (a.hotelId - b.hotelId || order[a.shiftKey] - order[b.shiftKey]) : a.date < b.date ? -1 : 1));
}

export async function getClaimsForDate(date, hotelId) {
  const { data, error } = await supabase.from("shift_claims").select("*").eq("date", date).eq("hotel_id", oneHotel(hotelId));
  if (error || !data) return {};
  const map = {};
  data.forEach((c) => { map[c.shift_key] = { username: c.username, name: c.name, claimedAt: new Date(c.claimed_at).getTime() }; });
  return map;
}

/* الحجز على مفتاح (date, shift_key) في الجدول بيمنع تلقائيًا حد تاني ياخد نفس الشيفت
   نفس اليوم - لو حد سبقك، الـ insert هيفشل بخطأ "duplicate key" بدل ما يتكتب فوقه. */
export async function claimShiftRow(date, shiftKey, username, name, hotelId) {
  const { error } = await supabase.from("shift_claims").insert({ hotel_id: oneHotel(hotelId), date, shift_key: shiftKey, username, name });
  if (error) {
    // الموظف عنده اختيار شيفت النهارده بالفعل (في الفندق ده أو فندق تاني): شيفت واحد لكل موظف في اليوم
    if (error.code === "23505" && /one_per_user_day/.test(error.message || "")) return { alreadyClaimed: true };
    if (error.code === "23505") return { conflict: true }; // unique_violation
    return { error: friendlyDbError(error) };
  }
  return { success: true };
}

export async function clearClaimRow(date, shiftKey, hotelId) {
  const { error } = await supabase.from("shift_claims").delete().eq("hotel_id", oneHotel(hotelId)).eq("date", date).eq("shift_key", shiftKey);
  return { error: error?.message };
}

/* لما المدير العام يلغي اختيار شيفت غلط، ورقة اليومية (shift_records) اللي
   اتعملت تحت نفس الشيفت بتُمسح معاه - دي ورقة مرتبطة بالاختيار ده تحديدًا
   ومن حقه يمسحها بالكامل. أي حجوزات أو تغييرات في حالة الغرف حصلت خلال نفس
   الوقت ده مش مرتبطة بشيفت معين في قاعدة البيانات، فمش بتُمسح تلقائيًا معاها
   - تحتاج مراجعة ومراجعة يدوية لو فيها خطأ (انظر ملاحظة في UsersPanel.jsx). */
export async function deleteShiftRecord(date, shiftKey, hotelId) {
  // .select() عشان نعرف عدد الصفوف اللي اتمسحت فعلاً: قاعدة البيانات بترفض مسح يومية مقفولة
  // (من غير خطأ - بترجّع صفر صفوف)، ومينفعش نقول للمدير إنها اتمسحت وهي لسه موجودة.
  const { data, error } = await supabase.from("shift_records").delete().eq("hotel_id", oneHotel(hotelId)).eq("date", date).eq("shift_key", shiftKey).select("date");
  return { error: error?.message, deleted: data?.length || 0 };
}

/* إعادة فتح شيفت مقفول - صلاحية مدير الحجوزات/المدير العام/الحسابات (انظر
   قسم ١٦ في schema.sql). بتصفّر بيانات القفل بس وتسيب باقي محتوى الشيفت
   زي ما هو، عشان موظف الشيفت يقدر يكمل/يصحح فيه. */
export async function reopenShiftRecord(date, shiftKey, expectedUpdatedAt, record) {
  return updateShiftRecordIfUnchanged(date, shiftKey, expectedUpdatedAt, { ...record, closed: false, closedBy: null, closedAt: null });
}

/* المدفوع الفعلي على حجز مقسّم بالوسيلة (وبتفاصيلها: الكارت/المحفظة) من اليومية نفسها - صافي
   التحصيل ناقص أي رد فلوس. بيتعرض في بطاقة الغرفة عشان واضح الفلوس اتدفعت إزاي من غير لخبطة. */
function paymentsFromRecords(recs, bookings) {
  const cur = new Map(bookings.map((b) => [b.id, b.currency]));
  const per = new Map();
  recs.forEach((r) => [...(r.rows || []), ...(r.cafeteriaRows || [])].forEach((x) => {
    if (!x.bookingId || !cur.has(x.bookingId)) return;
    const rowCur = x.collectionCurrency || "EGP";
    // دفعة قديمة بسعر صرف (قسم ٣٩): بتتحسب على الحجز بمقابلها بعملته (fxCovered) وبتتعرض بالمبلغ الفعلي وعملته
    const fx = x.fxCovered != null && rowCur !== cur.get(x.bookingId);
    const amt = fx ? Number(x.fxCovered) || 0 : Number(x.collectionAmt) || 0;
    if (!amt) return;
    // دفعة بعملة الخدمات التانية (قسم ٤٠): بتتعرض بعملتها - من غير تحويل
    const currency = fx ? cur.get(x.bookingId) : rowCur;
    const d = x.paymentDetails || {};
    const key = [x.collectionMethod, d.senderName || "", d.senderNumber || "", currency, fx ? x.collectionCurrency + "@" + x.fxRate : ""].join("|");
    const m = per.get(x.bookingId) || new Map();
    const e = m.get(key) || { method: x.collectionMethod, details: d, amount: 0, currency, ...(fx ? { fx: { currency: x.collectionCurrency, rate: Number(x.fxRate) || 0, amount: 0 } } : {}) };
    e.amount += amt; if (fx) e.fx.amount += Number(x.collectionAmt) || 0;
    m.set(key, e); per.set(x.bookingId, m);
  }));
  const out = new Map();
  per.forEach((m, id) => out.set(id, Array.from(m.values()).filter((p) => Math.abs(p.amount) > 0.004)));
  return out;
}
const earliest = (d) => (d < "2000-01-01" ? "2000-01-01" : d);
// أول يوم ممكن يكون فيه تحصيل على الحجز: أقدم من تاريخ الدخول وتاريخ إنشاء الحجز (عربون قبل الدخول بأيام كان بيطلع برا المدى)
const firstPayDay = (b) => {
  const created = b.createdAt ? new Date(b.createdAt).toISOString().slice(0, 10) : null;
  return created && created < b.checkin ? created : b.checkin;
};
export async function getBookingPayments(booking) {
  const recs = await getShiftRecordsInRange(earliest(addDays(firstPayDay(booking), -1)), addDays(shiftDayNow(), 1), booking.hotelId ?? getActiveHotelId());
  if (!recs) return null;
  return paymentsFromRecords(recs, [booking]).get(booking.id) || [];
}
/* نفس الحساب لقايمة حجوزات كاملة باستعلام واحد: Map(bookingId -> [{method, details, amount}]) */
export async function getPaymentsIndex(bookings) {
  const list = (bookings || []).filter((b) => b.checkin);
  if (!list.length) return new Map();
  const from = list.reduce((m, b) => (firstPayDay(b) < m ? firstPayDay(b) : m), firstPayDay(list[0]));
  const recs = await getShiftRecordsInRange(earliest(addDays(from, -1)), addDays(shiftDayNow(), 1));
  return recs ? paymentsFromRecords(recs, list) : null;
}

/* كل أرقام الحجوزات اللي تحصيلها اتسجّل في أي يومية شيفت (أي تاريخ) - التقارير
   بتستخدمها عشان تحصيل نفس الحجز مايتحسبش مرتين: مرة من اليومية (في تاريخها)
   ومرة تاني من قيمة amountPaid على الحجز في تاريخ تاني. بترجع null لو القراءة فشلت. */
export async function getJournaledBookingIds() {
  const { data, error } = await fetchAll(() => supabase.from("shift_records").select("hotel_id,date,shift_key,booking_collections", { count: "exact" }).order("date").order("hotel_id").order("shift_key"), 1000, (r) => `${r.hotel_id}|${r.date}|${r.shift_key}`);
  if (error || !data) return null;
  const set = new Set();
  data.forEach((r) => (r.booking_collections || []).forEach((e) => { if (e.bookingId) set.add(e.bookingId); }));
  return set;
}

/* شيفت الموظف الشغال دلوقتي + التاريخ اللي مسجّل عليه: يوم الشيفتات بيبدأ ٨ص،
   فالشيفت الليلي (١٢ص-٨ص) بيتسجّل على يوم المسائي اللي قبله، وأوفر تايمه
   (لحد ١٠ص) بيفضل على نفس التاريخ ده حتى بعد ما يوم الشيفتات يتغيّر الساعة ٨. */
export async function resolveMyShift(username, now = new Date()) {
  const base = shiftDayNow(now);
  // اختيار الموظف ممكن يكون في أي فندق (شيفت واحد في اليوم): بندوّر في كل الفنادق ونرجّع فندقه
  const mine = await getMyClaims(base, username);
  const hit = mine.find((c) => isShiftActiveNow(c.shiftKey, undefined, now));
  if (hit) return { date: base, key: hit.shiftKey, hotelId: hit.hotelId, claims: await getClaimsForDate(base, hit.hotelId) };
  const h = now.getHours();
  if (h >= 8 && h < 10) {
    const y = addDays(base, -1);
    const my = await getMyClaims(y, username);
    const night = my.find((c) => c.shiftKey === "night");
    if (night && isShiftActiveNow("night", undefined, now)) return { date: y, key: "night", hotelId: night.hotelId, claims: await getClaimsForDate(y, night.hotelId) };
  }
  return { date: base, key: null, hotelId: null, claims: await getClaimsForDate(base) };
}

/* اختيارات الموظف في يوم معين (في أي فندق): [{ hotelId, shiftKey }] */
export async function getMyClaims(date, username) {
  const { data, error } = await supabase.from("shift_claims").select("hotel_id,shift_key").eq("date", date).eq("username", username);
  if (error || !data) return [];
  const own = data.map((c) => ({ hotelId: c.hotel_id ?? 1, shiftKey: c.shift_key }));
  // شيفت مشترك: يوميات مفتوحة أنا زميل فيها (صاحب الشيفت ضافني)
  const { data: hs } = await supabase.from("shift_records").select("hotel_id,shift_key").eq("date", date).eq("closed", false).contains("helpers", [username]);
  for (const r of hs || []) if (!own.some((c) => c.hotelId === (r.hotel_id ?? 1) && c.shiftKey === r.shift_key)) own.push({ hotelId: r.hotel_id ?? 1, shiftKey: r.shift_key, helper: true });
  return own;
}


/* زملاء الشيفت المشترك: صاحب الشيفت (أو المدير العام/مدير الحجوزات) يحدد لحد ٣ موظفين يشتغلوا معاه على نفس اليومية */
export async function setShiftHelpers(hotelId, date, shiftKey, helpers) {
  const { data, error } = await supabase.rpc("set_shift_helpers", { p_hotel: hotelId, p_date: date, p_key: shiftKey, p_helpers: helpers });
  if (error) return { error: error.message };
  return { data };
}
export async function listShiftStaff() {
  const { data, error } = await supabase.rpc("list_shift_staff");
  if (error || !data) return [];
  return Array.isArray(data) ? data : [data];
}
