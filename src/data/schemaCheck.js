import { supabase } from "../lib/supabaseClient";

/* أقل نسخة مخطط (supabase/schema.sql) تشتغل معاها الواجهة دي. لازم تتطابق مع calma_schema_version() في آخر schema.sql. */
export const REQUIRED_SCHEMA_VERSION = 36;

// دالة (PostgREST) مش موجودة في الـ cache = القاعدة لسه ماتحدّثتش
export const isMissingFunctionError = (e) => !!e && (e.code === "PGRST202" || /Could not find the function|schema cache/i.test(e.message || ""));

// عمود/جدول مش موجود (PGRST204 / 42P01 / 42703) = برضه قاعدة قديمة (مثلًا يومية من غير cafeteria_rows)
export const isMissingSchemaObjectError = (e) => !!e && (isMissingFunctionError(e) || ["PGRST204", "42P01", "42703", "PGRST205"].includes(e.code) || /Could not find the '.*' column|does not exist/i.test(e.message || ""));

export const OUTDATED_SCHEMA_MESSAGE = "قاعدة البيانات لسه ماتحدّثتش لآخر نسخة (لازم يتشغّل supabase/schema.sql كامل) - بلّغ المدير العام";

// رسالة الخطأ اللي بتتعرض للمستخدم: لو السبب قاعدة قديمة نقول ده بدل رسالة تقنية بالإنجليزي
export const friendlyDbError = (e) => (isMissingSchemaObjectError(e) ? OUTDATED_SCHEMA_MESSAGE : (e?.message || String(e)));

/* بترجّع { ok: true } لو القاعدة على النسخة المطلوبة (أو أحدث)، { ok: false, version } لو أقدم، { ok: null } لو الفحص نفسه ماقدرش
   يتم (نت وقع مثلًا - مانحذّرش على أساسه). */
export async function checkSchemaVersion() {
  try {
    const { data, error } = await supabase.rpc("calma_schema_version");
    if (error) return isMissingFunctionError(error) ? { ok: false, version: 0 } : { ok: null };
    const v = Number(data) || 0;
    return { ok: v >= REQUIRED_SCHEMA_VERSION, version: v };
  } catch { return { ok: null }; }
}
