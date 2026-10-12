/* قراءة كل صفوف استعلام على صفحات: Supabase بترجّع ١٠٠٠ صف بالكتير بدون أي خطأ، فأي جدول بيكبر
   (حجوزات، يوميات، كافيتيريا) كان هيفقد أحدث/أقدم صفوفه من الشاشات والتقارير بصمت.
   build() لازم ترجّع استعلام جديد كل مرة وبترتيب ثابت (فيه معرّف كفاصل) عشان الصفحات ما تتداخلش.
   بترجّع { data } أو { error }؛ أي فشل في أي صفحة = فشل كله (مفيش نتيجة ناقصة). */
export async function fetchAll(build, pageSize = 1000) {
  const out = [];
  let total = null;
  for (let from = 0; ; ) {
    const { data, error, count } = await build().range(from, from + pageSize - 1);
    if (error) return { error };
    if (!data) return { error: { message: "no data" } };
    if (total == null && typeof count === "number") total = count;
    out.push(...data);
    from += data.length;
    if (data.length === 0 || (total != null && from >= total)) break;       // السيرفر ممكن يقصّ الصفحة عن pageSize، فبنمشي بعدد الصفوف الفعلي
    if (total == null && data.length < pageSize) break;
  }
  return { data: out };
}
