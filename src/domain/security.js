/*
  domain/security.js
  دوال تحقق وتنظيف مشتركة، مركزية في مكان واحد بدل ما تتكرر متفرقة في كل
  فورم لوحدها - أي تعديل مستقبلي على السياسة (زي رفع الحد الأدنى لطول
  الباسورد) يتغير هنا مرة واحدة بس.
*/

/*
  سياسة كلمة المرور: ٨ حروف على الأقل، وفيها حرف ورقم على الأقل. ده أقوى من
  الحد الأدنى الافتراضي (٦ حروف بس) من غير ما يكون معقد أوي على موظفين مش
  كلهم متمرسين تقنيًا.
*/
export function validatePasswordStrength(password) {
  const pw = String(password || "");
  if (pw.length < 8) return { ok: false, message: "كلمة المرور ٨ حروف على الأقل" };
  if (!/[A-Za-z]/.test(pw)) return { ok: false, message: "كلمة المرور لازم تحتوي على حرف واحد على الأقل" };
  if (!/[0-9]/.test(pw)) return { ok: false, message: "كلمة المرور لازم تحتوي على رقم واحد على الأقل" };
  return { ok: true, message: "" };
}

/* اسم المستخدم: حروف/أرقام/شرطة سفلية بس، من غير مسافات أو رموز غريبة قد
   تسبب مشاكل في تحويله لإيميل داخلي أو في عناوين URL. */
export function validateUsername(username) {
  const u = String(username || "").trim().toLowerCase();
  if (u.length < 3 || u.length > 30) return { ok: false, message: "اسم المستخدم لازم يكون من ٣ لـ ٣٠ حرف" };
  if (!/^[a-z0-9_]+$/.test(u)) return { ok: false, message: "اسم المستخدم يقبل بس حروف إنجليزية وأرقام و _" };
  return { ok: true, message: "" };
}

/*
  تنظيف نص حر (اسم نزيل، ملاحظة، إلخ): بتشيل حروف تحكم غير مرئية ممكن
  تتسبب في مشاكل عرض أو تُستخدم لأغراض خبيثة، وبتحدد أقصى طول معقول عشان
  حد ميقدرش يبعت نص ضخم يبوّظ الأداء أو التخزين. React أصلاً بيمنع XSS
  عند العرض (بيعمل escape تلقائي)، فده طبقة حماية إضافية مش الوحيدة.
*/
export function sanitizeText(value, maxLen = 300) {
  const s = String(value ?? "");
  // eslint-disable-next-line no-control-regex
  const stripped = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
  return stripped.slice(0, maxLen).trim();
}
