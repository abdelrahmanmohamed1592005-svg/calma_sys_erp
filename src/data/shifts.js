import { supabase } from "../lib/supabaseClient";
import { freshShiftRecord, applyCollectionToRows } from "../domain/money";
import { prevShiftOf, shiftDayNow, addDays, isShiftActiveNow } from "../domain/dates";
import { SHIFTS } from "../domain/constants";

function shiftFromRow(r) {
  return {
    date: r.date, shiftKey: r.shift_key, staffName: r.staff_name, staffUsername: r.staff_username,
    handover: r.handover || { EGP: 0, USD: 0 }, methodHandover: r.method_handover || {}, rows: r.rows || [], cafeteria: r.cafeteria || {}, hotelRows: r.hotel_rows || [],
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
    date: rec.date, shift_key: rec.shiftKey, staff_name: rec.staffName, staff_username: rec.staffUsername,
    handover: rec.handover, method_handover: rec.methodHandover, rows: rec.rows, cafeteria: rec.cafeteria, hotel_rows: rec.hotelRows || [],
    booking_collections: rec.bookingCollections || [], shift_notes: rec.shiftNotes,
    flagged: rec.flagged, closed: rec.closed, closed_by: rec.closedBy,
    closed_at: rec.closedAt ? new Date(rec.closedAt).toISOString() : null,
    total_expenses: rec.totalExpenses || null, total_collections: rec.totalCollections || null, closing_cash: rec.closingCash || null,
    cash_collections: rec.cashCollections || null, by_method_currency: rec.byMethodCurrency || null, by_category: rec.byCategory || null, method_closing: rec.methodClosing || null,
  };
}

export async function getShiftRecord(date, shiftKey) {
  const { data, error } = await supabase.from("shift_records").select("*").eq("date", date).eq("shift_key", shiftKey).maybeSingle();
  if (error || !data) return null;
  return shiftFromRow(data);
}

export async function createShiftRecord(rec) {
  const { data, error } = await supabase.from("shift_records").insert(shiftToRow(rec)).select().maybeSingle();
  if (error) return { error: error.message };
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
    .eq("date", date).eq("shift_key", shiftKey).eq("updated_at", expectedUpdatedAt)
    .select().maybeSingle();
  if (error) return { error: error.message };
  if (!data) return { conflict: true };
  return { data: shiftFromRow(data) };
}

/* كل سجلات اليومية في فترة (استعلام واحد بدل استعلام لكل شيفت في كل يوم -
   تقرير فترة سنة كان بيبعت أكتر من ١٠٠٠ طلب). بترجع null لو القراءة فشلت. */
export async function getShiftRecordsInRange(fromDate, toDate) {
  const { data, error } = await supabase.from("shift_records").select("*")
    .gte("date", fromDate).lte("date", toDate).order("date", { ascending: true });
  if (error || !data) return null;
  const order = { morning: 0, evening: 1, night: 2 };
  return data.map(shiftFromRow).sort((a, b) => (a.date === b.date ? order[a.shiftKey] - order[b.shiftKey] : a.date < b.date ? -1 : 1));
}

export async function getClaimsForDate(date) {
  const { data, error } = await supabase.from("shift_claims").select("*").eq("date", date);
  if (error || !data) return {};
  const map = {};
  data.forEach((c) => { map[c.shift_key] = { username: c.username, name: c.name, claimedAt: new Date(c.claimed_at).getTime() }; });
  return map;
}

/* الحجز على مفتاح (date, shift_key) في الجدول بيمنع تلقائيًا حد تاني ياخد نفس الشيفت
   نفس اليوم - لو حد سبقك، الـ insert هيفشل بخطأ "duplicate key" بدل ما يتكتب فوقه. */
export async function claimShiftRow(date, shiftKey, username, name) {
  const { error } = await supabase.from("shift_claims").insert({ date, shift_key: shiftKey, username, name });
  if (error) {
    if (error.code === "23505") return { conflict: true }; // unique_violation
    return { error: error.message };
  }
  return { success: true };
}

export async function clearClaimRow(date, shiftKey) {
  const { error } = await supabase.from("shift_claims").delete().eq("date", date).eq("shift_key", shiftKey);
  return { error: error?.message };
}

/* لما المدير العام يلغي اختيار شيفت غلط، ورقة اليومية (shift_records) اللي
   اتعملت تحت نفس الشيفت بتُمسح معاه - دي ورقة مرتبطة بالاختيار ده تحديدًا
   ومن حقه يمسحها بالكامل. أي حجوزات أو تغييرات في حالة الغرف حصلت خلال نفس
   الوقت ده مش مرتبطة بشيفت معين في قاعدة البيانات، فمش بتُمسح تلقائيًا معاها
   - تحتاج مراجعة ومراجعة يدوية لو فيها خطأ (انظر ملاحظة في UsersPanel.jsx). */
export async function deleteShiftRecord(date, shiftKey) {
  // .select() عشان نعرف عدد الصفوف اللي اتمسحت فعلاً: قاعدة البيانات بترفض مسح يومية مقفولة
  // (من غير خطأ - بترجّع صفر صفوف)، ومينفعش نقول للمدير إنها اتمسحت وهي لسه موجودة.
  const { data, error } = await supabase.from("shift_records").delete().eq("date", date).eq("shift_key", shiftKey).select("date");
  return { error: error?.message, deleted: data?.length || 0 };
}

/* إعادة فتح شيفت مقفول - صلاحية مدير الحجوزات/المدير العام/الحسابات (انظر
   قسم ١٦ في schema.sql). بتصفّر بيانات القفل بس وتسيب باقي محتوى الشيفت
   زي ما هو، عشان موظف الشيفت يقدر يكمل/يصحح فيه. */
export async function reopenShiftRecord(date, shiftKey, expectedUpdatedAt, record) {
  return updateShiftRecordIfUnchanged(date, shiftKey, expectedUpdatedAt, { ...record, closed: false, closedBy: null, closedAt: null });
}

/* بترجع سجل يومية الشيفت ده، وتنشئه أول مرة لو لسه معمول لو احتاج الأمر (نفس
   منطق "لحظة فتح شاشة اليومية" في DailyLedger.jsx بالظبط - عهدة الكاش وعهدة
   وسائل الدفع الأخرى بتتنقل تلقائيًا من إقفال آخر شيفت سابق لو كان مقفول).
   مستخدمة من appendBookingCollection تحت عشان تحصيل حجز من بلوك الغرف أو
   شاشة الحجوزات يتسجل في اليومية تلقائيًا حتى لو الموظف لسه مفتحش شاشة
   اليومية نفسها أصلًا النهارده. */
export async function ensureShiftRecord(date, shiftKey, profile, rooms) {
  let rec = await getShiftRecord(date, shiftKey);
  if (rec) return rec;
  const prev = prevShiftOf(date, shiftKey);
  const prevRec = await getShiftRecord(prev.date, prev.shiftKey);
  const prevClosing = prevRec && prevRec.closed ? prevRec.closingCash : undefined;
  const prevMethodClosing = prevRec && prevRec.closed ? prevRec.methodClosing : undefined;
  const fresh = freshShiftRecord(date, shiftKey, profile.name, profile.username, rooms, prevClosing, prevMethodClosing);
  const created = await createShiftRecord(fresh);
  if (created.data) return created.data;
  // فشل الإنشاء غالبًا لأن شاشة اليومية (أو جهاز تاني) أنشأت نفس السجل في نفس
  // اللحظة - نقرأ السجل الموجود فعليًا بدل ما نكمل على نسخة محلية مالهاش
  // updated_at (كانت هتخلي أي تعديل بعدها يفشل من غير سبب واضح).
  return await getShiftRecord(date, shiftKey);
}

/* تسجيل تحصيل (أو رد فلوس - amount سالب) حصل على حجز من بلوك الغرف أو شاشة
   الحجوزات تلقائيًا في يومية شيفت موظف الشيفت الحالي - بيضاف فعليًا لخانة
   "التحصيل" (المبلغ/الوسيلة/العملة) الخاصة بصف غرفة الحجز في جدول اليومية
   العادي نفسه - زي بالظبط لو الموظف كتبه بإيده - مش في جدول منفصل تاني.
   عشان رصيد الخزينة/التحصيل حسب طريقة الدفع في اليومية والتقارير يعكسوا
   الحقيقة من غير ما الموظف يحتاج يكتب نفس المبلغ تاني بنفسه (كان ده الفجوة
   قبل كده: تحصيل الكاش خصوصًا من الحجز مباشرة كان مش بيظهر في رصيد الدرج
   أصلًا إلا لو الموظف دخّله يدويًا تاني بنفسه في اليومية).
   بتعيد المحاولة لو فيه تعارض (حد تاني عدّل نفس سجل اليومية في نفس اللحظة
   بالظبط - نادر جدًا، أو الموظف كان بيكتب في اليومية في نفس الوقت) لحد ٤
   مرات قبل ما ترجّع خطأ. */
export async function appendBookingCollection(date, shiftKey, profile, rooms, entry) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const rec = await ensureShiftRecord(date, shiftKey, profile, rooms);
    if (!rec) return { error: "تعذر الوصول ليومية الشيفت" };
    if (!(rec.rows || []).some((r) => r.room === entry.room)) return { error: "الغرفة دي غير موجودة في جدول اليومية" };
    // applyCollectionToRows بتجمع على نفس صف الغرفة لو نفس وسيلة الدفع والعملة،
    // وإلا بتضيف صف جديد لنفس الغرفة في نفس الجدول - عشان ماتتخلطش وسيلتين
    // أو عملتين في خانة واحدة.
    const { rows } = applyCollectionToRows(rec.rows, entry);
    // تتبّع داخلي بس (مش ظاهر في أي شاشة) لمنع حساب نفس المبلغ مرتين في
    // التقارير - انظر الملاحظة على bookingCollections في domain/money.js.
    const bookingCollections = [...(rec.bookingCollections || []), { id: entry.id, bookingId: entry.bookingId }];
    const res = await updateShiftRecordIfUnchanged(date, shiftKey, rec.updatedAt, { ...rec, rows, bookingCollections });
    if (res.data) return { data: res.data };
    if (res.error) return res;
    // conflict - حد تاني عدّل نفس السجل في نفس اللحظة، نجرّب تاني بأحدث نسخة
  }
  return { error: "تعارض متكرر على سجل اليومية - التحصيل سُجّل على الحجز لكن محتاج يُضاف يدويًا في اليومية" };
}

/* كل أرقام الحجوزات اللي تحصيلها اتسجّل في أي يومية شيفت (أي تاريخ) - التقارير
   بتستخدمها عشان تحصيل نفس الحجز مايتحسبش مرتين: مرة من اليومية (في تاريخها)
   ومرة تاني من قيمة amountPaid على الحجز في تاريخ تاني. بترجع null لو القراءة فشلت. */
export async function getJournaledBookingIds() {
  const { data, error } = await supabase.from("shift_records").select("booking_collections");
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
  const claims = await getClaimsForDate(base);
  const key = SHIFTS.map((s) => s.key).find((k) => claims[k]?.username === username && isShiftActiveNow(k, undefined, now));
  if (key) return { date: base, key, claims };
  const h = now.getHours();
  if (h >= 8 && h < 10) {
    const y = addDays(base, -1);
    const cy = await getClaimsForDate(y);
    if (cy.night?.username === username && isShiftActiveNow("night", undefined, now)) return { date: y, key: "night", claims: cy };
  }
  return { date: base, key: null, claims };
}
