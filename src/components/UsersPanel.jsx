import React, { useState, useEffect } from "react";
import { Info, UserPlus, Key, Check } from "lucide-react";
import { ROLES, SHIFTS } from "../domain/constants";
import { todayStr } from "../domain/dates";
import { getClaimsForDate, clearClaimRow } from "../data/shifts";
import { signUpUser, setProfileActive, adminResetPassword } from "../lib/auth";

export function UsersPanel({ users, onRefresh, currentUsername, readOnly, onLog, showToast, dataVersion }) {
  const [form, setForm] = useState(null);
  const [resetTarget, setResetTarget] = useState(null);
  const [resetPw, setResetPw] = useState("");
  const [claims, setClaims] = useState(null);
  const today = todayStr();

  useEffect(() => { if (!readOnly) (async () => setClaims(await getClaimsForDate(today)))(); }, [readOnly, dataVersion]);

  async function clearClaim(shiftKey) {
    const res = await clearClaimRow(today, shiftKey);
    if (res.error) { showToast(res.error); return; }
    setClaims((prev) => { const next = { ...prev }; delete next[shiftKey]; return next; });
    onLog(`المدير العام ألغى اختيار شيفت ${SHIFTS.find((s) => s.key === shiftKey)?.label} النهارده عشان تصحيح خطأ`);
    showToast("اتلغى الاختيار - أي موظف يقدر يختاره تاني");
  }

  function startNew() { setForm({ name: "", username: "", role: "staff", pw: "" }); }
  async function saveNew() {
    if (!form.name.trim() || !form.username.trim() || form.pw.length < 6) { showToast("املأ كل الحقول - كلمة المرور ٦ حروف على الأقل"); return; }
    const uname = form.username.trim().toLowerCase();
    if (users.some((u) => u.username === uname)) { showToast("اسم المستخدم موجود بالفعل"); return; }
    const res = await signUpUser({ username: uname, password: form.pw, name: form.name.trim(), role: form.role });
    if (res.error) { showToast(res.error); return; }
    onRefresh(); onLog(`إضافة مستخدم جديد: ${uname} (${ROLES.find((r) => r.key === form.role)?.label})`);
    setForm(null); showToast("تم إنشاء الحساب");
  }
  async function toggleActive(u) {
    if (u.role === "gm" && u.active) { const activeGms = users.filter((x) => x.role === "gm" && x.active); if (activeGms.length <= 1) { showToast("لازم يفضل مدير عام واحد فعّال على الأقل"); return; } }
    const res = await setProfileActive(u.id, !u.active);
    if (res.error) { showToast(res.error); return; }
    onRefresh(); onLog(`${u.active ? "تعطيل" : "تفعيل"} حساب ${u.username}`); showToast("تم التحديث");
  }
  async function submitReset() {
    if (resetPw.length < 6) { showToast("كلمة المرور ٦ حروف على الأقل"); return; }
    const res = await adminResetPassword(resetTarget, resetPw);
    if (res.error) { showToast(res.error); return; }
    onLog(`إعادة تعيين كلمة مرور ${resetTarget}`); setResetTarget(null); setResetPw(""); showToast("تم تغيير كلمة المرور");
  }

  return (
    <div style={{ padding: 14 }}>
      <div className="cx-card" style={{ padding: 10, marginBottom: 12, fontSize: 12, color: "var(--muted)", display: "flex", gap: 6 }}><Info size={14} style={{ flexShrink: 0, marginTop: 1 }} />الحساب الوحيد اللي يقدر يضيف موظفين جدد أو يعطّل حساب هو المدير العام. مفيش تسجيل حساب مفتوح لأي حد. {readOnly && "إنت بتشوف القائمة دي للعلم بس، مفيش تعديل من هنا."}</div>

      {!readOnly && claims && (
        <div className="cx-card" style={{ padding: 12, marginBottom: 14 }}>
          <div style={{ fontWeight: 800, marginBottom: 6 }}>شيفتات النهارده</div>
          <div style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 8 }}>لو حد اختار شيفت غلط بالغلط، تقدر تلغي اختياره من هنا عشان يقدر يختار تاني (تصحيح إداري بس).</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {SHIFTS.map((s) => (
              <div key={s.key} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12.5, borderBottom: "1px solid var(--hair)", padding: "6px 0" }}>
                <span>{s.label}: {claims[s.key] ? claims[s.key].name : <span style={{ color: "var(--muted)" }}>لسه محدش اختاره</span>}</span>
                {claims[s.key] && <button className="cx-btn cx-btn-outline" style={{ fontSize: 11.5 }} onClick={() => clearClaim(s.key)}>إلغاء الاختيار</button>}
              </div>
            ))}
          </div>
        </div>
      )}

      {!readOnly && (<div style={{ marginBottom: 12, display: "flex", justifyContent: "flex-end" }}><button className="cx-btn cx-btn-gold" onClick={startNew}><UserPlus size={14} /> مستخدم جديد</button></div>)}

      {!readOnly && form && (
        <div className="cx-card" style={{ padding: 14, marginBottom: 14 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 8 }}>
            <div><label style={{ fontSize: 11, color: "var(--muted)" }}>الاسم</label><input className="cx-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div><label style={{ fontSize: 11, color: "var(--muted)" }}>اسم المستخدم</label><input className="cx-input" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} /></div>
            <div><label style={{ fontSize: 11, color: "var(--muted)" }}>الدور</label><select className="cx-select" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>{ROLES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}</select></div>
            <div><label style={{ fontSize: 11, color: "var(--muted)" }}>كلمة المرور</label><input className="cx-input" type="password" value={form.pw} onChange={(e) => setForm({ ...form, pw: e.target.value })} /></div>
          </div>
          <div style={{ marginTop: 12, display: "flex", gap: 8 }}><button className="cx-btn cx-btn-gold" onClick={saveNew}><Check size={14} /> حفظ</button><button className="cx-btn cx-btn-outline" onClick={() => setForm(null)}>إلغاء</button></div>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {users.map((u) => (
          <div key={u.username} className="cx-card" style={{ padding: 12, display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, opacity: u.active ? 1 : 0.55 }}>
            <div><div style={{ fontWeight: 800 }}>{u.name} {u.username === currentUsername && <span style={{ fontSize: 11, color: "var(--muted)" }}>(أنت)</span>}</div><div style={{ fontSize: 12, color: "var(--muted)" }}>@{u.username} · {ROLES.find((r) => r.key === u.role)?.label} {!u.active && "· معطّل"}</div></div>
            {!readOnly && (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {resetTarget === u.username ? (
                  <span style={{ display: "flex", gap: 4 }}><input className="cx-input" type="password" placeholder="كلمة مرور جديدة" style={{ width: 140 }} value={resetPw} onChange={(e) => setResetPw(e.target.value)} /><button className="cx-btn cx-btn-gold" onClick={submitReset}>حفظ</button><button className="cx-btn cx-btn-outline" onClick={() => { setResetTarget(null); setResetPw(""); }}>إلغاء</button></span>
                ) : (<button className="cx-btn cx-btn-outline" onClick={() => { setResetTarget(u.username); setResetPw(""); }}><Key size={13} /> إعادة تعيين كلمة المرور</button>)}
                <button className="cx-btn cx-btn-outline" onClick={() => toggleActive(u)}>{u.active ? "تعطيل" : "تفعيل"}</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
