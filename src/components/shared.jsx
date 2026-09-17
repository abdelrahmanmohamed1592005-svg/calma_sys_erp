import React, { useState } from "react";
import { ONLINE_METHODS } from "../domain/money";

export function GlobalStyle() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@300;400;500;700;800&family=Fraunces:ital,wght@1,500&display=swap');
      .calma-app{ --ink:#161D27; --paper:#FBF9F4; --paper2:#F3EFE2; --gold:#B8912F; --teal:#1F4B4A; --sage:#3F7A5C; --rust:#A8503B; --slate:#3D5A73; --hair:#E4DCC9; --text:#23282E; --muted:#6B6357;
        font-family:'Tajawal',sans-serif; background:var(--paper); color:var(--text); min-height:100vh; }
      .calma-app *{ box-sizing:border-box; }
      .cx-logo{ font-family:'Fraunces',serif; font-style:italic; }
      .cx-header{ background:var(--ink); color:#EFE9DA; }
      .cx-tab{ border-bottom:3px solid transparent; color:var(--muted); }
      .cx-tab.active{ border-bottom-color:var(--gold); color:var(--ink); font-weight:700; }
      .cx-card{ background:#fff; border:1px solid var(--hair); border-radius:12px; box-shadow:0 1px 3px rgba(23,20,10,0.05); }
      .cx-input, .cx-select, .cx-textarea{ background:#fff; border:1px solid var(--hair); border-radius:6px; padding:6px 8px; font-family:inherit; color:var(--text); font-size:13px; width:100%; }
      .cx-input:focus, .cx-select:focus, .cx-textarea:focus{ outline:2px solid var(--gold); outline-offset:1px; }
      .cx-btn{ border-radius:7px; padding:8px 14px; font-weight:700; font-size:13px; cursor:pointer; border:1px solid transparent; display:inline-flex; align-items:center; gap:6px; }
      .cx-btn-gold{ background:var(--gold); color:#2B2109; }
      .cx-btn-gold:hover{ background:#A57F27; }
      .cx-btn-outline{ background:transparent; border-color:var(--hair); color:var(--ink); }
      .cx-btn-outline:hover{ background:var(--paper2); }
      .cx-btn-danger{ background:#fff; border-color:var(--rust); color:var(--rust); }
      .cx-btn:disabled{ opacity:0.45; cursor:not-allowed; }
      .cx-pill{ border-radius:999px; padding:3px 10px; font-size:12px; font-weight:700; display:inline-block; }
      .cx-th{ position:sticky; top:0; background:var(--paper2); }
      .cx-toast{ position:fixed; bottom:18px; left:50%; transform:translateX(-50%); background:var(--ink); color:#fff; padding:10px 18px; border-radius:8px; font-size:13px; z-index:50; }
      .cx-tile{ border:1px solid var(--hair); border-right:5px solid var(--muted); border-radius:10px; background:#fff; padding:10px; cursor:pointer; transition:transform .12s; box-shadow:0 1px 2px rgba(23,20,10,0.04); }
      .cx-tile:hover{ transform:translateY(-2px); }
      .cx-tile.selected{ box-shadow:0 0 0 2px var(--gold) inset; }
      .cx-kpi{ background:linear-gradient(180deg,#fff,var(--paper2)); border:1px solid var(--hair); border-radius:12px; padding:12px 14px; }
      table.cx-table{ border-collapse:collapse; width:100%; }
      table.cx-table td, table.cx-table th{ border:1px solid var(--hair); padding:5px 6px; vertical-align:middle; }
      ::placeholder{ color:#B3AA97; }
      @media print{ .cx-no-print{ display:none !important; } }
    `}</style>
  );
}

export function LoadingScreen({ inline }) {
  return <div style={{ padding: inline ? "3rem 1rem" : "6rem 1rem", textAlign: "center", color: "var(--muted)" }}>جارِ التحميل...</div>;
}

export function ConfigWarningBanner() {
  return (
    <div style={{ position: "fixed", bottom: 0, insetInlineStart: 0, insetInlineEnd: 0, background: "#A8503B", color: "#fff", padding: "10px 16px", fontSize: 12.5, textAlign: "center", zIndex: 60 }}>
      ⚠ السيستم مش متوصل بقاعدة البيانات لسه - راجع ملف .env زي ما موضح في README.md
    </div>
  );
}

export function Logo({ size = 34 }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="19" fill="none" stroke="#B8912F" strokeWidth="1.4" /><text x="20" y="27" textAnchor="middle" fontFamily="Fraunces, serif" fontStyle="italic" fontSize="20" fill="#1F4B4A">C</text></svg>
      <span className="cx-logo" style={{ fontSize: size * 0.62 }}>Calma</span>
    </div>
  );
}

export function TwoStepButton({ label, confirmLabel = "تأكيد؟", onConfirm, className = "cx-btn-danger", icon }) {
  const [confirming, setConfirming] = useState(false);
  if (confirming) return (<span style={{ display: "inline-flex", gap: 4 }}><button className="cx-btn cx-btn-danger" onClick={() => { setConfirming(false); onConfirm(); }}>{confirmLabel}</button><button className="cx-btn cx-btn-outline" onClick={() => setConfirming(false)}>إلغاء</button></span>);
  return <button className={"cx-btn " + className} onClick={() => setConfirming(true)}>{icon}{label}</button>;
}

export function PaymentDetailsInline({ method, details, onChange, disabled }) {
  if (!ONLINE_METHODS.includes(method)) return <span style={{ fontSize: 11, color: "var(--muted)" }}>—</span>;
  const d = details || { senderName: "", senderNumber: "", ref: "" };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 120 }}>
      <input className="cx-input" style={{ fontSize: 11, padding: "4px 6px" }} placeholder="اسم المرسل" disabled={disabled} value={d.senderName} onChange={(e) => onChange({ ...d, senderName: e.target.value })} />
      <input className="cx-input" style={{ fontSize: 11, padding: "4px 6px" }} placeholder={method === "فيزا" ? "آخر ٤ أرقام الكارت" : "رقم المحفظة / الهاتف"} disabled={disabled} value={d.senderNumber} onChange={(e) => onChange({ ...d, senderNumber: e.target.value })} />
      <input className="cx-input" style={{ fontSize: 11, padding: "4px 6px" }} placeholder="رقم العملية / ملاحظة" disabled={disabled} value={d.ref} onChange={(e) => onChange({ ...d, ref: e.target.value })} />
    </div>
  );
}

/*
  حماية من "CSV Formula Injection": لو اسم نزيل أو ملاحظة بدأت بـ = أو + أو -
  أو @، برنامج زي Excel ممكن يتعامل معاها كصيغة (formula) بدل نص عادي لما
  الموظف يفتح الملف المُصدَّر - ده ثغرة معروفة (CWE-1236). الحل: نحط علامة
  اقتباس ' قدام أي قيمة بتبدأ بالحروف دي، فتتقرا كنص دايمًا مهما كان محتواها.
*/
function csvSafeCell(v) {
  const s = String(v ?? "");
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

export function downloadCSV(filename, headers, rows) {
  const csv = [headers.join(","), ...rows.map((r) => r.map((v) => `"${csvSafeCell(v).replace(/"/g, '""')}"`).join(","))].join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = filename; document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}
