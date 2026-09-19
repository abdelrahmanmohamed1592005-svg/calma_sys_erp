import React, { useState } from "react";
import { Info, Download } from "lucide-react";
import { GlobalStyle, Logo, downloadCSV } from "./shared";
import { arabicWeekday, arabicDateLong, todayStr } from "../domain/dates";
import { validatePasswordStrength, validateUsername } from "../domain/security";

export function SetupScreen({ onCreate }) {
  const [name, setName] = useState(""); const [username, setUsername] = useState(""); const [pw, setPw] = useState(""); const [pw2, setPw2] = useState(""); const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  async function submit() {
    if (!name.trim() || !username.trim()) { setErr("املأ كل الحقول"); return; }
    const uCheck = validateUsername(username);
    if (!uCheck.ok) { setErr(uCheck.message); return; }
    const pCheck = validatePasswordStrength(pw);
    if (!pCheck.ok) { setErr(pCheck.message); return; }
    if (pw !== pw2) { setErr("كلمتا المرور غير متطابقتين"); return; }
    setErr(""); setBusy(true);
    const res = await onCreate({ name: name.trim(), username: username.trim().toLowerCase(), pw });
    if (res?.error) { setErr(res.error); setBusy(false); }
  }
  return (
    <div className="calma-app" dir="rtl" style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <GlobalStyle />
      <div className="cx-card" style={{ width: "100%", maxWidth: 400, padding: "28px 22px" }}>
        <div style={{ textAlign: "center", marginBottom: 8 }}><Logo /></div>
        <div style={{ textAlign: "center", fontSize: 13, color: "var(--muted)", marginBottom: 8 }}>الإعداد الأول - إنشاء حساب المدير العام</div>
        <div style={{ background: "var(--paper2)", borderRadius: 8, padding: 10, fontSize: 11.5, color: "var(--muted)", marginBottom: 16, display: "flex", gap: 6 }}><Info size={14} style={{ flexShrink: 0, marginTop: 1 }} />هذه الشاشة تظهر مرة واحدة فقط. بعدها، الحساب الوحيد اللي يقدر يضيف موظفين جدد هو المدير العام من صفحة "إدارة المستخدمين".</div>
        <label style={{ fontSize: 13, fontWeight: 700, display: "block", marginBottom: 4 }}>الاسم بالكامل</label>
        <input className="cx-input" value={name} onChange={(e) => setName(e.target.value)} style={{ marginBottom: 12 }} />
        <label style={{ fontSize: 13, fontWeight: 700, display: "block", marginBottom: 4 }}>اسم المستخدم</label>
        <input className="cx-input" value={username} onChange={(e) => setUsername(e.target.value)} style={{ marginBottom: 12 }} placeholder="بالإنجليزي، بدون مسافات" />
        <label style={{ fontSize: 13, fontWeight: 700, display: "block", marginBottom: 4 }}>كلمة المرور</label>
        <input className="cx-input" type="password" value={pw} onChange={(e) => setPw(e.target.value)} style={{ marginBottom: 4 }} />
        <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 12 }}>٨ حروف على الأقل، وفيها حرف ورقم</div>
        <label style={{ fontSize: 13, fontWeight: 700, display: "block", marginBottom: 4 }}>تأكيد كلمة المرور</label>
        <input className="cx-input" type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} style={{ marginBottom: 12 }} />
        {err && <div style={{ color: "var(--rust)", fontSize: 12.5, marginBottom: 10 }}>{err}</div>}
        <button className="cx-btn cx-btn-gold" style={{ width: "100%", justifyContent: "center" }} disabled={busy} onClick={submit}>إنشاء الحساب والدخول</button>
      </div>
    </div>
  );
}

export function LoginScreen({ onLogin }) {
  const [username, setUsername] = useState(""); const [pw, setPw] = useState(""); const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  async function submit() {
    setErr(""); setBusy(true);
    // حماية: لو الدخول نجح لكن التحقق من الـ profile بعده فشل بصمت (حساب من
    // غير profile، أو معطّل)، الزرار متفضلش عالقة "بتحمّل" للأبد من غير أي
    // توضيح - بعد 6 ثواني هيرجع قابل للدوس وهيوري رسالة واضحة.
    const stuckTimer = setTimeout(() => {
      setBusy(false);
      setErr("تعذر الدخول - تأكد إن الحساب مفعّل وعنده بيانات كاملة، أو كلّم المدير العام");
    }, 6000);
    const res = await onLogin({ username: username.trim(), password: pw });
    clearTimeout(stuckTimer);
    if (res?.error) { setErr(res.error); setBusy(false); }
  }
  return (
    <div className="calma-app" dir="rtl" style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <GlobalStyle />
      <div className="cx-card" style={{ width: "100%", maxWidth: 380, padding: "28px 22px" }}>
        <div style={{ textAlign: "center", marginBottom: 20 }}><Logo /><div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>نظام إدارة الفندق</div></div>
        <label style={{ fontSize: 13, fontWeight: 700, display: "block", marginBottom: 4 }}>اسم المستخدم</label>
        <input className="cx-input" value={username} onChange={(e) => setUsername(e.target.value)} style={{ marginBottom: 12 }} onKeyDown={(e) => e.key === "Enter" && submit()} />
        <label style={{ fontSize: 13, fontWeight: 700, display: "block", marginBottom: 4 }}>كلمة المرور</label>
        <input className="cx-input" type="password" value={pw} onChange={(e) => setPw(e.target.value)} style={{ marginBottom: 12 }} onKeyDown={(e) => e.key === "Enter" && submit()} />
        {err && <div style={{ color: "var(--rust)", fontSize: 12.5, marginBottom: 10 }}>{err}</div>}
        <button className="cx-btn cx-btn-gold" style={{ width: "100%", justifyContent: "center" }} disabled={busy || !username || !pw} onClick={submit}>دخول</button>
        <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 12, textAlign: "center" }}>ما فيش تسجيل حساب جديد من هنا. الحسابات بتتعمل من المدير العام فقط.</div>
      </div>
    </div>
  );
}

export function LogoutReportScreen({ user, actions, onExportAndLogout }) {
  const date = todayStr();
  function handleExport() {
    const headers = ["الوقت", "الإجراء"];
    const rows = actions.map((a) => [new Date(a.ts).toLocaleString("ar-EG"), a.action]);
    downloadCSV(`تقرير-${user.username}-${date}.csv`, headers, rows);
    onExportAndLogout();
  }
  return (
    <div className="calma-app" dir="rtl" style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <GlobalStyle />
      <div className="cx-card" style={{ width: "100%", maxWidth: 520, padding: "26px 22px" }}>
        <div style={{ textAlign: "center", marginBottom: 12 }}><Logo /></div>
        <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 6, textAlign: "center" }}>لازم تصدّر تقرير تعديلاتك قبل الخروج</div>
        <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 14, textAlign: "center" }}>عملت {actions.length} تعديل/إجراء النهارده ({arabicWeekday(date)} · {date}) — دوس "تصدير وتسجيل الخروج" عشان يتحفظلك ملف بكل حاجة عملتها.</div>
        <div style={{ maxHeight: 260, overflowY: "auto", border: "1px solid var(--hair)", borderRadius: 8, marginBottom: 14 }}>
          {actions.map((a) => (
            <div key={a.id} style={{ padding: "8px 10px", borderBottom: "1px solid var(--hair)", fontSize: 12.5, display: "flex", justifyContent: "space-between", gap: 8 }}>
              <span>{a.action}</span><span style={{ color: "var(--muted)", whiteSpace: "nowrap" }}>{new Date(a.ts).toLocaleTimeString("ar-EG")}</span>
            </div>
          ))}
        </div>
        <button className="cx-btn cx-btn-gold" style={{ width: "100%", justifyContent: "center" }} onClick={handleExport}><Download size={14} /> تصدير التقرير وتسجيل الخروج</button>
      </div>
    </div>
  );
}
