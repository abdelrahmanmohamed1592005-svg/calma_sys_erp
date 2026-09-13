import React, { useState } from "react";
import { LogOut, Key } from "lucide-react";
import { Logo } from "./shared";
import { arabicWeekday, arabicDateLong, todayStr } from "../domain/dates";
import { ROLES, TAB_LABELS } from "../domain/constants";

export function Header({ user, onLogout, onChangePassword }) {
  const date = todayStr();
  const [showPw, setShowPw] = useState(false);
  return (
    <div className="cx-no-print">
      <div className="cx-header" style={{ padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}><Logo size={28} /><span style={{ fontSize: 12, opacity: 0.75 }}>{arabicWeekday(date)} · {arabicDateLong(date)}</span></div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ textAlign: "left", fontSize: 12 }}><div style={{ fontWeight: 700 }}>{user.name}</div><div style={{ opacity: 0.7 }}>{ROLES.find((r) => r.key === user.role)?.label}</div></div>
          <button onClick={() => setShowPw((s) => !s)} title="تغيير كلمة المرور" className="cx-btn" style={{ background: "transparent", color: "#EFE9DA", border: "1px solid #3A4550", padding: "6px 8px" }}><Key size={15} /></button>
          <button onClick={onLogout} title="تسجيل خروج" className="cx-btn" style={{ background: "transparent", color: "#EFE9DA", border: "1px solid #3A4550", padding: "6px 8px" }}><LogOut size={15} /></button>
        </div>
      </div>
      {showPw && <ChangePasswordBar onSubmit={(pw) => { onChangePassword(pw); setShowPw(false); }} onCancel={() => setShowPw(false)} />}
    </div>
  );
}

function ChangePasswordBar({ onSubmit, onCancel }) {
  const [pw, setPw] = useState(""); const [pw2, setPw2] = useState(""); const [err, setErr] = useState("");
  function submit() { if (pw.length < 6) { setErr("كلمة المرور ٦ حروف على الأقل"); return; } if (pw !== pw2) { setErr("كلمتا المرور غير متطابقتين"); return; } onSubmit(pw); }
  return (
    <div style={{ background: "var(--paper2)", padding: 10, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", borderBottom: "1px solid var(--hair)" }}>
      <span style={{ fontSize: 12.5, fontWeight: 700 }}>كلمة مرور جديدة:</span>
      <input className="cx-input" type="password" style={{ width: 140 }} value={pw} onChange={(e) => setPw(e.target.value)} />
      <input className="cx-input" type="password" placeholder="تأكيد" style={{ width: 140 }} value={pw2} onChange={(e) => setPw2(e.target.value)} />
      {err && <span style={{ color: "var(--rust)", fontSize: 12 }}>{err}</span>}
      <button className="cx-btn cx-btn-gold" onClick={submit}>حفظ</button>
      <button className="cx-btn cx-btn-outline" onClick={onCancel}>إلغاء</button>
    </div>
  );
}

export function TabBar({ tabs, active, onChange }) {
  return (
    <div className="cx-no-print" style={{ display: "flex", gap: 4, overflowX: "auto", borderBottom: "1px solid var(--hair)", background: "var(--paper)", padding: "0 10px" }}>
      {tabs.map((t) => <button key={t} onClick={() => onChange(t)} className={"cx-tab " + (active === t ? "active" : "")} style={{ background: "transparent", border: "none", padding: "12px 14px", fontSize: 13.5, whiteSpace: "nowrap", cursor: "pointer" }}>{TAB_LABELS[t]}</button>)}
    </div>
  );
}
