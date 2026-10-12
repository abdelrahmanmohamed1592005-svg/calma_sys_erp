/* عدّاد عمليات الكتابة اللي لسه شغالة (حفظ حجز، تحصيل، رد فلوس، تمديد...) -
   main.jsx بيستنى لحد ما يبقى صفر قبل ما يطبّق تحديث نسخة جديدة وإعادة تحميل
   الصفحة، عشان الريلود ما يجيش في النص بين "حفظ الحجز" و"تسجيله في اليومية". */
export async function withBusy(fn) {
  window.__calmaBusyCount = (window.__calmaBusyCount || 0) + 1;
  try { return await fn(); } finally { window.__calmaBusyCount = Math.max(0, (window.__calmaBusyCount || 1) - 1); }
}

/* زي withBusy بس بيمنع نفس العملية (نفس المفتاح) تتنفّذ مرتين في نفس الوقت - دوسة
   مزدوجة على "تسجيل التحصيل" أو "حفظ الحجز" ماتسجّلش المبلغ/الحجز مرتين. */
const running = new Set();
export async function guarded(key, fn) {
  if (running.has(key)) return undefined;
  running.add(key);
  try { return await withBusy(fn); } finally { running.delete(key); }
}
