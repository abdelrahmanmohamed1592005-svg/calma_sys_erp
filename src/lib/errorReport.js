import { supabase } from "./supabaseClient";

/*
  سجل أخطاء السيستم: أي خطأ غير متوقع عند أي مستخدم (شاشة بيضا، خطأ برمجي، رفض غريب من قاعدة البيانات)
  بيتبعت لجدول client_errors - المدير العام والمطوّر بيشوفوه في "سجل الحركة"، وفحص الليل (GitHub) بيبعت إيميل لو فيه أخطاء.
  رسايل القواعد العادية (زي "المبلغ أكبر من المتبقي") مش أخطاء ومش بتتسجّل، ولا انقطاع النت.
*/
const sent = new Map();
let count = 0;
const MAX_PER_SESSION = 30;

export const isNetworkError = (e) => !!e && !e.code && /fetch|network|timeout|load failed|aborted|offline/i.test(e.message || String(e));

/* خطأ قاعدة بيانات يستاهل يتسجّل؟ رسايل raise exception (P0001) = رسايل قواعد السيستم للمستخدم، مش أخطاء */
export function isUnexpectedDbError(e) {
  if (!e || isNetworkError(e)) return false;
  if (e.code === "P0001") return false;
  return true;
}

export function reportError(kind, message, detail) {
  try {
    const msg = String(message || "").slice(0, 500);
    if (!msg || count >= MAX_PER_SESSION) return;
    const key = kind + "|" + msg;
    const now = Date.now();
    if (sent.has(key) && now - sent.get(key) < 10 * 60 * 1000) return;   // نفس الخطأ مرة كل ١٠ دقايق بس
    sent.set(key, now);
    count += 1;
    const page = typeof location !== "undefined" ? location.pathname + location.hash : "";
    const agent = typeof navigator !== "undefined" ? navigator.userAgent : "";
    Promise.resolve(supabase.rpc("log_client_error", { p_kind: kind, p_message: msg, p_detail: String(detail || "").slice(0, 2000), p_page: page.slice(0, 200), p_agent: agent.slice(0, 300) }))
      .catch(() => {});
  } catch { /* تسجيل الخطأ نفسه مايوقّعش السيستم أبدًا */ }
}

/* خطأ من قاعدة البيانات (supabase-js) - بيتسجّل لو كان غير متوقع */
export function reportDbError(where, e) {
  if (isUnexpectedDbError(e)) reportError("db", `${where}: ${e.message || e}`, [e.code, e.details, e.hint].filter(Boolean).join(" | "));
}

let installed = false;
export function installGlobalErrorReporting() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("error", (ev) => {
    if (!ev || !ev.message || /ResizeObserver loop/i.test(ev.message)) return;
    reportError("js", ev.message, `${ev.filename || ""}:${ev.lineno || ""}:${ev.colno || ""}\n${ev.error?.stack || ""}`);
  });
  window.addEventListener("unhandledrejection", (ev) => {
    const r = ev?.reason;
    if (isNetworkError(r)) return;
    reportError("promise", r?.message || String(r), r?.stack || "");
  });
}
