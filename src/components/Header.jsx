import { useState } from "react";
import { LogOut, Key, Search, LayoutGrid, NotebookPen, CalendarCheck2, BarChart3, History, Users } from "lucide-react";
import { Logo, initials } from "./shared";
import { arabicWeekday, arabicDateLong, todayStr } from "../domain/dates";
import { ROLES, TAB_LABELS } from "../domain/constants";
import { validatePasswordStrength } from "../domain/security";

/* أسامي قصيرة لشريط الموبايل (التحت) عشان الكلام مايدخلش في بعض */
const TAB_SHORT = { board: "الغرف", ledger: "اليومية", bookings: "الحجوزات", reports: "التقارير", activity: "السجل", users: "الموظفين" };
const TAB_ICONS = { board: LayoutGrid, ledger: NotebookPen, bookings: CalendarCheck2, reports: BarChart3, activity: History, users: Users };

/* وصف قصير تحت عنوان كل صفحة - عشان الموظف يعرف هو فين وإيه اللي يقدر يعمله هنا */
export const TAB_HINTS = {
  board: "حالة كل الغرف لحظة بلحظة - اضغط على أي غرفة تشوف تفاصيلها وتحصّل منها",
  ledger: "يومية الشيفت: المصاريف والتحصيل وعهدة الخزينة",
  bookings: "كل الحجوزات في مكان واحد - إضافة وتعديل وتحصيل وإلغاء",
  reports: "تقرير يوم أو فترة: التحصيل والمصاريف والخزينة",
  activity: "كل إجراء اتعمل في السيستم ومين عمله",
  users: "حسابات الموظفين وأدوارهم",
};


export function Header({ user, onLogout, onChangePassword, onOpenSearch }) {
  const date = todayStr();
  const [showPw, setShowPw] = useState(false);
  return (
    <>
      <header className="cx-header cx-no-print">
        <div style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 0 }}>
          <Logo size={26} light />
          <span className="cx-date">{arabicWeekday(date)} · {arabicDateLong(date)}</span>
        </div>
        {onOpenSearch && (
          <button className="cx-search-btn" onClick={onOpenSearch} aria-label="بحث سريع (Ctrl+K)" title="بحث سريع (Ctrl+K)">
            <Search size={16} aria-hidden="true" /><span className="cx-search-txt">بحث عن نزيل أو غرفة...</span><kbd>Ctrl K</kbd>
          </button>
        )}
        <div className="cx-user">
          <div className="cx-user-meta" style={{ textAlign: "left", fontSize: 13.5, lineHeight: 1.35 }}>
            <div style={{ fontWeight: 700 }}>{user.name}</div>
            <div style={{ opacity: 0.7 }}>{ROLES.find((r) => r.key === user.role)?.label}</div>
          </div>
          <span className="cx-avatar" aria-hidden="true">{initials(user.name)}</span>
          <button onClick={() => setShowPw((s) => !s)} title="تغيير كلمة المرور" aria-label="تغيير كلمة المرور" className="cx-icon-btn"><Key size={16} /></button>
          <button onClick={onLogout} title="تسجيل خروج" aria-label="تسجيل خروج" className="cx-icon-btn"><LogOut size={16} /></button>
        </div>
      </header>
      {showPw && <ChangePasswordBar onSubmit={async (pw) => { const ok = await onChangePassword(pw); if (ok) setShowPw(false); }} onCancel={() => setShowPw(false)} />}
    </>
  );
}

function ChangePasswordBar({ onSubmit, onCancel }) {
  const [pw, setPw] = useState(""); const [pw2, setPw2] = useState(""); const [err, setErr] = useState("");
  function submit() {
    const check = validatePasswordStrength(pw);
    if (!check.ok) { setErr(check.message); return; }
    if (pw !== pw2) { setErr("كلمتا المرور غير متطابقتين"); return; }
    onSubmit(pw);
  }
  return (
    <div className="cx-no-print" style={{ gridColumn: "1 / -1", background: "var(--gold-soft)", padding: "12px 18px", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", borderBottom: "1px solid var(--hair)" }}>
      <span style={{ fontSize: 14, fontWeight: 700 }}>كلمة مرور جديدة:</span>
      <input className="cx-input" type="password" aria-label="كلمة مرور جديدة" style={{ width: 180 }} value={pw} onChange={(e) => setPw(e.target.value)} />
      <input className="cx-input" type="password" placeholder="تأكيد" aria-label="تأكيد كلمة المرور" style={{ width: 180 }} value={pw2} onChange={(e) => setPw2(e.target.value)} />
      {err && <span style={{ color: "var(--rust)", fontSize: 14 }}>{err}</span>}
      <button className="cx-btn cx-btn-gold" onClick={submit}>حفظ</button>
      <button className="cx-btn cx-btn-outline" onClick={onCancel}>إلغاء</button>
    </div>
  );
}

export function TabBar({ tabs, active, onChange, badges = {} }) {
  return (
    <nav className="cx-nav cx-no-print" aria-label="أقسام النظام">
      <div className="cx-nav-title" aria-hidden="true">القائمة</div>
      {tabs.map((t) => {
        const Icon = TAB_ICONS[t];
        return (
          <button key={t} data-tab={t} aria-label={TAB_LABELS[t] + (badges[t] > 0 ? ` (${badges[t]})` : "")} onClick={() => onChange(t)} className={"cx-tab " + (active === t ? "active" : "")} aria-current={active === t ? "page" : undefined}>
            {Icon && <Icon size={18} aria-hidden="true" />}
            <span className="lbl-full">{TAB_LABELS[t]}</span><span className="lbl-short" aria-hidden="true">{TAB_SHORT[t] || TAB_LABELS[t]}</span>
            {badges[t] > 0 && <span className="cx-badge">{badges[t]}</span>}
          </button>
        );
      })}
    </nav>
  );
}

export function PageHead({ tab, actions }) {
  return (
    <div className="cx-page-head cx-no-print">
      <div>
        <h1>{TAB_LABELS[tab]}</h1>
        <p>{TAB_HINTS[tab]}</p>
      </div>
      {actions}
    </div>
  );
}
