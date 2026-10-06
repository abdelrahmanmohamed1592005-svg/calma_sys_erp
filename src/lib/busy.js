/* عدّاد عمليات الكتابة اللي لسه شغالة (حفظ حجز، تحصيل، رد فلوس، تمديد...) -
   main.jsx بيستنى لحد ما يبقى صفر قبل ما يطبّق تحديث نسخة جديدة وإعادة تحميل
   الصفحة، عشان الريلود ما يجيش في النص بين "حفظ الحجز" و"تسجيله في اليومية". */
export async function withBusy(fn) {
  window.__calmaBusyCount = (window.__calmaBusyCount || 0) + 1;
  try { return await fn(); } finally { window.__calmaBusyCount = Math.max(0, (window.__calmaBusyCount || 1) - 1); }
}
