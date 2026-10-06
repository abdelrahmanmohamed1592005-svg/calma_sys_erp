export function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function addDays(dateStr, delta) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + delta);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

export function arabicWeekday(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Intl.DateTimeFormat("ar-EG", { weekday: "long" }).format(new Date(y, m - 1, d));
}

export function arabicDateLong(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Intl.DateTimeFormat("ar-EG", { day: "numeric", month: "long", year: "numeric" }).format(new Date(y, m - 1, d));
}

export function nightsBetween(inS, outS) {
  if (!inS || !outS) return 0;
  const [y1, m1, d1] = inS.split("-").map(Number);
  const [y2, m2, d2] = outS.split("-").map(Number);
  return Math.max(0, Math.round((new Date(y2, m2 - 1, d2) - new Date(y1, m1 - 1, d1)) / 86400000));
}

export function parseDateFlexible(s) {
  if (!s) return null;
  s = String(s).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  const d = new Date(s);
  if (!isNaN(d)) return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return null;
}

/* يوم الشيفتات التشغيلي: بيبدأ مع الشيفت الصباحي (٨ص) ويكمل لحد ٨ص اليوم
   اللي بعده - يعني شيفت ليلي (١٢ص-٨ص) وأوفر تايم المسائي بعد نص الليل
   بيتسجّلوا على يوم الشيفت المسائي اللي قبلهم، مش على التاريخ الجديد بتاع
   التقويم. ده بيخلّي ترتيب الشيفتات (صباحي ← مسائي ← ليلي) ونقل العهدة بينهم
   متسق. (حجوزات الفندق نفسها بتفضل بتاريخ التقويم العادي.) */
export function shiftDayNow(now = new Date()) {
  const cal = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return now.getHours() < 8 ? addDays(cal, -1) : cal;
}

export const SHIFT_ORDER = ["morning", "evening", "night"];

export function defaultShiftForNow() {
  const h = new Date().getHours();
  if (h >= 8 && h < 16) return "morning";
  if (h >= 16 && h < 24) return "evening";
  return "night";
}

// حدود وقت كل شيفت (نظام 24 ساعة) - الليلي بيعدي نص الليل فبنمثّله ٠-٨.
const SHIFT_WINDOWS = { morning: { start: 8, end: 16 }, evening: { start: 16, end: 24 }, night: { start: 0, end: 8 } };

// أقصى مدة "أوفر تايم" يفضل فيها الشيفت/اليومية مفتوحين تلقائيًا بعد نهاية
// معاد الشيفت الرسمي، لو موظف الشيفت لسه مكمّلش قفل بنفسه. بعد المدة دي
// النظام يعتبر الشيفت لازم يتقفل (المدير العام/مدير الحجوزات يقدروا يفتحوه
// تاني وقت ما احتاج الأمر).
export const SHIFT_OVERTIME_GRACE_HOURS = 2;

/* هل دلوقتي لسه "وقت" الشيفت ده فعليًا - يا إما داخل معاده الرسمي، يا إما
   داخل هامش الأوفر تايم (ساعتين) بعد نهايته مباشرة. بيتعامل مع حالة الشيفت
   المسائي اللي أوفر التايم بتاعه بيعدي نص الليل (مثلاً ٢٤:٠٠ لحد ٢:٠٠ صباحًا). */
export function isShiftActiveNow(shiftKey, graceHours = SHIFT_OVERTIME_GRACE_HOURS, now = new Date()) {
  const win = SHIFT_WINDOWS[shiftKey];
  if (!win) return false;
  const h = now.getHours() + now.getMinutes() / 60;
  if (h >= win.start && h < win.end) return true;
  const otStart = win.end % 24;
  const otEnd = otStart + graceHours;
  if (otEnd <= 24) return h >= otStart && h < otEnd;
  return h >= otStart || h < otEnd - 24;
}

/* كل مفاتيح الشيفتات النشطة دلوقتي (عادي أو أوفر تايم) - ممكن يرجع أكتر من
   شيفت واحد في نفس اللحظة (مثلاً شيفت مسائي في أوفر تايم + شيفت ليلي بدأ
   فعليًا في معاده الرسمي، الاتنين ممكن يكونوا "نشطين" في نفس الدقيقة). */
export function activeShiftKeysNow(graceHours = SHIFT_OVERTIME_GRACE_HOURS, now = new Date()) {
  return SHIFT_ORDER.filter((k) => isShiftActiveNow(k, graceHours, now));
}

export function nextShiftOf(date, shiftKey) {
  const idx = SHIFT_ORDER.indexOf(shiftKey);
  if (idx < 2) return { date, shiftKey: SHIFT_ORDER[idx + 1] };
  return { date: addDays(date, 1), shiftKey: "morning" };
}

export function prevShiftOf(date, shiftKey) {
  const idx = SHIFT_ORDER.indexOf(shiftKey);
  if (idx > 0) return { date, shiftKey: SHIFT_ORDER[idx - 1] };
  return { date: addDays(date, -1), shiftKey: "night" };
}

export function isSameDay(ts, dateStr) {
  const d = new Date(ts);
  const s = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return s === dateStr;
}

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
