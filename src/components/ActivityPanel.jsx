import { useEffect, useState } from "react";
import { Search, History, SearchX, AlertTriangle } from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { ROLES } from "../domain/constants";
import { initials, EmptyState } from "./shared";


const dayKey = (ts) => { const d = new Date(ts); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };
function dayTitle(ts) {
  const d = new Date(ts); const now = new Date(); const y = new Date(now); y.setDate(now.getDate() - 1);
  if (dayKey(d) === dayKey(now)) return "النهارده";
  if (dayKey(d) === dayKey(y)) return "امبارح";
  return d.toLocaleDateString("ar-EG-u-nu-latn", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

/* أخطاء السيستم (للمدير العام والمطوّر): أي خطأ غير متوقع حصل عند أي مستخدم - عشان نعرف بالمشكلة قبل ما حد يشتكي */
function SystemErrors() {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    let c = false;
    supabase.from("client_errors").select("id, at, username, user_role, kind, message, detail, page").order("at", { ascending: false }).limit(100)
      .then(({ data, error }) => { if (!c) setRows(error ? [] : data || []); });
    return () => { c = true; };
  }, []);
  if (!rows) return null;
  const last24 = rows.filter((r) => Date.now() - new Date(r.at).getTime() < 864e5).length;
  return (
    <details className="cx-card cx-no-print" data-testid="system-errors" style={{ padding: 12, marginBottom: 14, borderColor: last24 ? "var(--rust)" : undefined }}>
      <summary style={{ cursor: "pointer", fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}>
        <AlertTriangle size={15} aria-hidden="true" style={{ color: last24 ? "var(--rust)" : "var(--muted)" }} />
        أخطاء السيستم <span style={{ fontWeight: 400, color: "var(--muted)", fontSize: 13 }}>({last24 ? `${last24} في آخر ٢٤ ساعة` : "مفيش أخطاء في آخر ٢٤ ساعة"} - آخر {rows.length} محفوظة)</span>
      </summary>
      {rows.length === 0 ? <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 8 }}>مفيش أي أخطاء متسجّلة.</div> : (
        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6, maxHeight: 420, overflowY: "auto" }}>
          {rows.map((r) => (
            <div key={r.id} data-testid="system-error-row" style={{ fontSize: 13, borderTop: "1px solid var(--hair2)", paddingTop: 6 }}>
              <div style={{ color: "var(--muted)" }}><bdi dir="ltr">{new Date(r.at).toLocaleString("ar-EG-u-nu-latn")}</bdi> · {r.username || "؟"}{r.user_role ? ` (${ROLES.find((x) => x.key === r.user_role)?.label || r.user_role})` : ""} · {r.kind}</div>
              <div dir="auto" style={{ wordBreak: "break-word" }}>{r.message}</div>
              {r.detail && <details><summary style={{ cursor: "pointer", fontSize: 12, color: "var(--muted)" }}>تفاصيل تقنية</summary><pre dir="ltr" style={{ fontSize: 11, whiteSpace: "pre-wrap", wordBreak: "break-word", margin: 0 }}>{r.detail}{r.page ? `\npage: ${r.page}` : ""}</pre></details>}
            </div>
          ))}
        </div>
      )}
    </details>
  );
}

export function ActivityPanel({ activity, showErrors = false }) {
  const [q, setQ] = useState("");
  const qq = q.trim().toLowerCase();
  const list = qq ? activity.filter((a) => `${a.user} ${a.action}`.toLowerCase().includes(qq)) : activity;
  return (
    <div className="cx-page">
      {showErrors && <SystemErrors />}
      <div className="cx-toolbar cx-no-print" style={{ marginBottom: 14, justifyContent: "space-between" }}>
        <div style={{ position: "relative", flex: "1 1 260px", maxWidth: 380 }}>
          <Search size={16} aria-hidden="true" style={{ position: "absolute", insetInlineStart: 11, top: 12, color: "var(--faint)" }} />
          <input className="cx-input" aria-label="بحث في سجل الحركة" style={{ paddingInlineStart: 34 }} placeholder="بحث باسم الموظف أو الإجراء" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div style={{ fontSize: 13, color: "var(--muted)" }}>بيعرض آخر 300 حركة.</div>
      </div>
      {list.length === 0 && (activity.length === 0
        ? <EmptyState icon={History} title="لا يوجد حركات مسجلة بعد" hint="أي إجراء بيتعمل في السيستم (حجز، تحصيل، إقفال شيفت...) هيظهر هنا باسم اللي عمله ووقته." />
        : <EmptyState icon={SearchX} title="مفيش حركات مطابقة للبحث" hint="جرّب اسم موظف تاني أو كلمة من الإجراء." />)}
      <div className="cx-card" style={{ overflow: "hidden", display: list.length ? "block" : "none" }}>
        {list.map((a, i) => { const day = dayKey(a.ts); const newDay = i === 0 || dayKey(list[i - 1].ts) !== day; return (
          <div key={a.id}>
          {newDay && <div className="cx-day-sep" aria-hidden="true">{dayTitle(a.ts)}</div>}
          <div style={{ padding: "12px 16px", fontSize: 14, display: "flex", gap: 12, alignItems: "flex-start", borderTop: !newDay ? "1px solid var(--hair2)" : "none" }}>
            <span className="cx-avatar" aria-hidden="true" style={{ width: 32, height: 32, fontSize: 13 }}>{initials(a.user)}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div><b>{a.user}</b> <span className="cx-pill" style={{ background: "var(--paper2)", color: "var(--muted)", fontSize: 12, fontWeight: 500 }}>{ROLES.find((r) => r.key === a.role)?.label}</span></div>
              <div style={{ color: "var(--text)", marginTop: 2, wordBreak: "break-word" }}>{a.action}</div>
            </div>
            <div style={{ color: "var(--muted)", whiteSpace: "nowrap", fontSize: 12.5 }} title={new Date(a.ts).toLocaleString("ar-EG-u-nu-latn")}>{new Date(a.ts).toLocaleString("ar-EG-u-nu-latn")}</div>
          </div>
          </div>
        ); })}
      </div>
    </div>
  );
}
