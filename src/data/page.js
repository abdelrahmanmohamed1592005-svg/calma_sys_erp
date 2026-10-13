/* قراءة كل صفوف استعلام على صفحات: Supabase بترجّع ١٠٠٠ صف بالكتير بدون أي خطأ، فأي جدول بيكبر
   (حجوزات، يوميات، كافيتيريا) كان هيفقد أحدث/أقدم صفوفه من الشاشات والتقارير بصمت.
   build() لازم ترجّع استعلام جديد كل مرة وبترتيب ثابت (فيه معرّف كفاصل) عشان الصفحات ما تتداخلش.
   لو حد ضاف/مسح صف أثناء القراءة (الإزاحة بتتحرك: صف بيتكرر وصف بيتنسي): بنكتشف ده من اختلاف العدد الكلي بين الصفحات
   ونعيد القراءة من الأول (لحد ٣ مرات)، وبنشيل أي تكرار بالمفتاح كخط دفاع أخير.
   بترجّع { data } أو { error }؛ أي فشل في أي صفحة = فشل كله (مفيش نتيجة ناقصة). */
const defaultKey = (r) => r.id ?? `${r.date}|${r.shift_key}`;

export async function fetchAll(build, pageSize = 1000, key = defaultKey) {
  let out = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    out = [];
    let total = null, drifted = false;
    for (let from = 0; ; ) {
      const { data, error, count } = await build().range(from, from + pageSize - 1);
      if (error) return { error };
      if (!data) return { error: { message: "no data" } };
      if (typeof count === "number") { if (total == null) total = count; else if (count !== total) drifted = true; }
      out.push(...data);
      from += data.length;
      if (data.length === 0 || (total != null && from >= total)) break;       // السيرفر ممكن يقصّ الصفحة عن pageSize، فبنمشي بعدد الصفوف الفعلي
      if (total == null && data.length < pageSize) break;
    }
    if (!drifted) break;
  }
  const seen = new Set();
  return { data: out.filter((r) => { const k = key(r); if (seen.has(k)) return false; seen.add(k); return true; }) };
}
