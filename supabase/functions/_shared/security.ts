// supabase/functions/_shared/security.ts
// دوال مشتركة بين كل الـ Edge Functions - مش فنكشن مستقلة بنفسها، بيتم
// استيرادها بس. أي تعديل هنا بيأثر على كل الفنكشنز اللي بتستخدمها.

/*
  CORS: القيمة الافتراضية "*" (مفتوح) عشان النظام يفضل شغال زي ما هو من غير
  أي كسر لحد ما تحدد نطاقك الحقيقي. لتقييدها فعليًا، حطي في Supabase secrets:
    supabase secrets set ALLOWED_ORIGIN=https://your-domain.vercel.app
  وبعدها الفنكشن هيرفض أي طلب جاي من نطاق تاني.
*/
export function buildCorsHeaders(req: Request) {
  const allowedOrigin = Deno.env.get("ALLOWED_ORIGIN");
  const requestOrigin = req.headers.get("Origin") || "";
  let originHeader = "*";
  if (allowedOrigin) {
    const allowList = allowedOrigin.split(",").map((s) => s.trim());
    originHeader = allowList.includes(requestOrigin) ? requestOrigin : "null";
  }
  return {
    "Access-Control-Allow-Origin": originHeader,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}

/*
  Rate limiting بأفضل جهد ممكن (best-effort): الذاكرة دي بتتصفّر كل ما
  الفنكشن تاخد "cold start" جديد (طبيعة serverless)، فده مش بديل كامل عن
  حل مخصص زي Upstash Redis، لكنه طبقة حماية إضافية حقيقية ضد إساءة استخدام
  سريعة من نفس المصدر. تسجيل الدخول نفسه محمي أصلاً بـ Rate Limiting جاهز
  من Supabase Auth على مستوى المنصة (Dashboard -> Authentication -> Rate Limits).
*/
const rateBuckets = new Map<string, number[]>();

export function isRateLimited(key: string, maxRequests = 8, windowMs = 60_000): boolean {
  const now = Date.now();
  const timestamps = (rateBuckets.get(key) || []).filter((t) => now - t < windowMs);
  timestamps.push(now);
  rateBuckets.set(key, timestamps);
  return timestamps.length > maxRequests;
}

export function validatePasswordStrength(password: unknown): { ok: boolean; message: string } {
  const pw = String(password || "");
  if (pw.length < 8) return { ok: false, message: "كلمة المرور ٨ حروف على الأقل" };
  if (pw.length > 128) return { ok: false, message: "كلمة المرور طويلة جدًا (الحد الأقصى ١٢٨ حرف)" };
  if (!/[A-Za-z]/.test(pw)) return { ok: false, message: "كلمة المرور لازم تحتوي على حرف واحد على الأقل" };
  if (!/[0-9]/.test(pw)) return { ok: false, message: "كلمة المرور لازم تحتوي على رقم واحد على الأقل" };
  return { ok: true, message: "" };
}

/*
  متسيبيش رسالة خطأ خام (زي تفاصيل Postgres الداخلية) توصل للمستخدم - يتسجل
  كامل في الـ logs (تقدري تشوفيه من Supabase Dashboard) وبيترجع للمستخدم
  رسالة عامة آمنة بس.
*/
export function safeServerError(context: string, error: unknown): string {
  // eslint-disable-next-line no-console
  console.error(`[${context}]`, error);
  return "حصل خطأ في السيرفر، حاول تاني أو كلّم الدعم الفني";
}

// التوكن من هيدر Authorization (Bearer) - بيرجّع "" لو مش موجود أو الصيغة غلط.
export function bearerToken(req: Request): string {
  const m = (req.headers.get("Authorization") || "").match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : "";
}

// أقصى حجم لجسم الطلب (بالبايت) - الطلبات الصحيحة هنا صغيرة جدًا.
export const MAX_BODY_BYTES = 10_000;

// قراءة JSON بحد أقصى للحجم؛ بترمي خطأ لو الجسم كبير أو مش JSON صالح.
export async function readJsonBody(req: Request): Promise<Record<string, unknown>> {
  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) throw new Error("body too large");
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid body");
  return parsed as Record<string, unknown>;
}
