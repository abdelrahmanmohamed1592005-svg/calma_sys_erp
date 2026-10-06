import React, { useState, useEffect } from "react";
import { Info, UserPlus, Key, Check, AlertTriangle } from "lucide-react";
import { TwoStepButton } from "./shared";
import { ROLES, SHIFTS } from "../domain/constants";
import { shiftDayNow } from "../domain/dates";
import { getClaimsForDate, clearClaimRow, deleteShiftRecord, getShiftRecord } from "../data/shifts";
import { adminCreateUser, setProfileActive, adminResetPassword } from "../lib/auth";
import { validatePasswordStrength, validateUsername, sanitizeText } from "../domain/security";

export function UsersPanel({ users, onRefresh, currentUsername, readOnly, onLog, showToast, dataVersion }) {
  const [form, setForm] = useState(null);
  const [resetTarget, setResetTarget] = useState(null);
  const [resetPw, setResetPw] = useState("");
  const [claims, setClaims] = useState(null);
  const today = shiftDayNow();

  useEffect(() => { if (!readOnly) (async () => setClaims(await getClaimsForDate(today)))(); }, [readOnly, dataVersion]);

  // إلغاء اختيار شيفت غلط: بيمسح الاختيار نفسه + ورقة اليومية (shift_records)
  // المرتبطة بيه تحديدًا (دي ورقة تخص الاختيار الغلط ده بس، فمسحها كاملة
  // منطقي وآمن). لكن أي حجوزات أو تغييرات حالة غرف حصلت في نفس الوقت ده مش
  // مرتبطة بشيفت معيّن في قاعدة البيانات، فمش بتُمسح أو تترجع تلقائيًا معاها -
  // لو فيها خطأ حقيقي، المدير العام/مدير الحجوزات يراجعوها ويصلّحوها يدويًا
  // من شاشة الحجوزات/بلوك الغرف (الصلاحية دي متاحة لهم بالفعل).
  async function clearClaim(shiftKey) {
    // نمسح ورقة اليومية الأول: لو فشل المسح مانلغيش الاختيار (كان هيسيب ورقة
    // يتيمة والرسالة تقول إنها اتمسحت).
    const existing = await getShiftRecord(today, shiftKey);
    if (existing?.closed) { showToast("اليومية دي مقفولة - افتحها الأول من تاب اليومية (استعراض شيفتات سابقة) وبعدها ألغي الاختيار"); return; }
    const del = await deleteShiftRecord(today, shiftKey);
    if (del.error) { showToast("تعذر مسح ورقة اليومية: " + del.error); return; }
    if (existing && del.deleted === 0) { showToast("ورقة اليومية ماتمسحتش (ممكن حد قفلها دلوقتي) - حدّث الصفحة وجرّب تاني"); return; }
    const res = await clearClaimRow(today, shiftKey);
    if (res.error) { showToast(res.error); return; }
    setClaims((prev) => { const next = { ...prev }; delete next[shiftKey]; return next; });
    onLog(`المدير العام ألغى اختيار شيفت ${SHIFTS.find((s) => s.key === shiftKey)?.label} النهارده عشان تصحيح خطأ (ورقة اليومية بتاعة الشيفت ده اتمسحت معاه)`);
    showToast("اتلغى الاختيار وورقة اليومية بتاعته - أي حجوزات أو تغييرات غرف حصلت في نفس الوقت تحتاج تتراجع يدويًا لو فيها خطأ");
  }

  function startNew() { setForm({ name: "", username: "", role: "staff", pw: "" }); }
  const [busy, setBusy] = useState(false);
  async function guarded(fn) { if (busy) return; setBusy(true); try { await fn(); } finally { setBusy(false); } }
  async function saveNew() { return guarded(saveNewInner); }
  async function saveNewInner() {
    const name = sanitizeText(form.name, 80);
    if (!name) { showToast("اكتب الاسم"); return; }
    const uCheck = validateUsername(form.username);
    if (!uCheck.ok) { showToast(uCheck.message); return; }
    const pCheck = validatePasswordStrength(form.pw);
    if (!pCheck.ok) { showToast(pCheck.message); return; }
    const uname = form.username.trim().toLowerCase();
    if (users.some((u) => u.username === uname)) { showToast("اسم المستخدم موجود بالفعل"); return; }
    const res = await adminCreateUser({ username: uname, password: form.pw, name, role: form.role });
    if (res.error) { showToast(res.error); return; }
    onRefresh(); onLog(`إضافة مستخدم جديد: ${uname} (${ROLES.find((r) => r.key === form.role)?.label})`);
    setForm(null); showToast("تم إنشاء الحساب");
  }
  async function toggleActive(u) { return guarded(() => toggleActiveInner(u)); }
  async function toggleActiveInner(u) {
    if (u.active && u.username === currentUsername) { showToast("مينفعش تعطّل حسابك إنت"); return; }
    if (u.role === "gm" && u.active) { const activeGms = users.filter((x) => x.role === "gm" && x.active); if (activeGms.length <= 1) { showToast("لازم يفضل مدير عام واحد فعّال على الأقل"); return; } }
    const res = await setProfileActive(u.id, !u.active);
    if (res.error) { showToast(res.error); return; }
    onRefresh(); onLog(`${u.active ? "تعطيل" : "تفعيل"} حساب ${u.username}`); showToast("تم التحديث");
  }
  async function submitReset() { return guarded(submitResetInner); }
  async function submitResetInner() {
    const check = validatePasswordStrength(resetPw);
    if (!check.ok) { showToast(check.message); return; }
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
          <div style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 8 }}>لو حد اختار شيفت غلط بالغلط، تقدر تلغي اختياره من هنا عشان يقدر يختار تاني (تصحيح إداري بس). تنبيه: ده بيمسح ورقة اليومية بتاعة الشيفت ده كاملة، أما أي حجوزات أو تغييرات غرف حصلت في نفس الوقت فمش بتُمسح أو تترجع تلقائيًا - لازم تراجعيها وتصلّحيها يدويًا لو فيها خطأ.</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {SHIFTS.map((s) => (
              <div key={s.key} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12.5, borderBottom: "1px solid var(--hair)", padding: "6px 0" }}>
                <span>{s.label}: {claims[s.key] ? claims[s.key].name : <span style={{ color: "var(--muted)" }}>لسه محدش اختاره</span>}</span>
                {claims[s.key] && <TwoStepButton label="إلغاء الاختيار" confirmLabel="مسح ورقة اليومية وإلغاء الاختيار؟" icon={<AlertTriangle size={12} />} onConfirm={() => clearClaim(s.key)} />}
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
                {u.active ? <TwoStepButton className="cx-btn-outline" label="تعطيل" confirmLabel="تأكيد التعطيل؟" onConfirm={() => toggleActive(u)} /> : <button className="cx-btn cx-btn-outline" disabled={busy} onClick={() => toggleActive(u)}>تفعيل</button>}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
