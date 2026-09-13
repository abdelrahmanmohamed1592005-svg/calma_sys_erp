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

export const SHIFT_ORDER = ["morning", "evening", "night"];

export function defaultShiftForNow() {
  const h = new Date().getHours();
  if (h >= 8 && h < 16) return "morning";
  if (h >= 16 && h < 24) return "evening";
  return "night";
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
