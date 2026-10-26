import { useState } from "react";
import { Search, History, SearchX } from "lucide-react";
import { ROLES } from "../domain/constants";
import { initials, EmptyState } from "./shared";


const dayKey = (ts) => { const d = new Date(ts); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };
function dayTitle(ts) {
  const d = new Date(ts); const now = new Date(); const y = new Date(now); y.setDate(now.getDate() - 1);
  if (dayKey(d) === dayKey(now)) return "النهارده";
  if (dayKey(d) === dayKey(y)) return "امبارح";
  return d.toLocaleDateString("ar-EG-u-nu-latn", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

export function ActivityPanel({ activity }) {
  const [q, setQ] = useState("");
  const qq = q.trim().toLowerCase();
  const list = qq ? activity.filter((a) => `${a.user} ${a.action}`.toLowerCase().includes(qq)) : activity;
  return (
    <div className="cx-page">
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
