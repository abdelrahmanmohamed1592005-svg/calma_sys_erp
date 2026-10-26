import { useState, useEffect, useLayoutEffect, useRef } from "react";
import { COMMON_CURRENCIES, onlineRoomCovered, ONLINE_METHODS, refundStatusOf, bookingGrandTotal, bookingAmountDue, fmt, isVisaMethod, normalizeLast4, normalizePhone, emptyPaymentDetails, describePaymentDetails } from "../domain/money";
import { PRINT_FIT_CSS } from "../lib/printFit";
import { roomLabel, roomDisplay } from "../domain/constants";

/* حقل نص بيكبر لوحده: لو البيان طويل بينزل على سطر تاني بدل ما يتقصّ (نفس شكل وسلوك الـ <input> العادي:
   Enter مابيعملش سطر جديد). بيتقاس تاني لما النص أو عرض الصفحة يتغيّر. */
export function AutoText({ value, style, onKeyDown, ...rest }) {
  const ref = useRef(null);
  const fit = () => { const el = ref.current; if (!el) return; el.style.height = "auto"; el.style.height = `${el.scrollHeight + 2}px`; };
  useLayoutEffect(fit, [value]);
  useEffect(() => {
    // الحقل جوه قسم مطوي (مخفي) بيتقاس بصفر؛ لما يظهر أو عرضه يتغيّر بنعيد القياس
    const el = ref.current; let w = el ? el.clientWidth : 0;
    const ro = typeof ResizeObserver !== "undefined" && el ? new ResizeObserver(() => { if (el.clientWidth !== w) { w = el.clientWidth; fit(); } }) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, []);
  return (
    <textarea ref={ref} rows={1} value={value ?? ""} data-autotext="1"
      onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); onKeyDown?.(e); }}
      style={{ resize: "none", overflow: "hidden", display: "block", lineHeight: 1.45, minHeight: 32, ...style }} {...rest} />
  );
}

export function GlobalStyle() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&family=Fraunces:ital,wght@1,500&display=swap');
      .calma-app{
        --ink:#132A3D; --ink2:#1D3A52; --paper:#F5F3EE; --paper2:#EEEAE0; --surface:#FFFFFF; --gold:#B8912F; --gold-d:#977420; --gold-soft:#F6EED9;
        --teal:#1F4B4A; --sage:#2F7A4F; --rust:#B4452E; --slate:#3D5A73; --hair:#E5DFD1; --hair2:#EEE9DD; --text:#1F262D; --muted:#5F5A50; --faint:#8C8577;
        --ok-bg:#E8F3EC; --bad-bg:#FBE9E5; --warn-bg:#FFF4DC; --info-bg:#E9F0F6;
        --r:14px; --r-s:10px; --sh:0 1px 2px rgba(20,32,43,.05), 0 4px 16px -8px rgba(20,32,43,.12); --sh-l:0 18px 40px -18px rgba(20,32,43,.35);
        --nav-w:236px; --top-h:60px;
        font-family:'IBM Plex Sans Arabic','Tajawal',system-ui,sans-serif; font-size:14px; line-height:1.55; background:var(--paper); color:var(--text); min-height:100vh;
        -webkit-font-smoothing:antialiased; font-variant-numeric:tabular-nums;
      }
      .calma-app *{ box-sizing:border-box; }
      .calma-app button, .calma-app input, .calma-app select, .calma-app textarea{ font-family:inherit; }
      .cx-logo{ font-family:'Fraunces',serif; font-style:italic; letter-spacing:.01em; }

      /* ---------- app shell ---------- */
      .cx-shell{ min-height:100vh; }
      .cx-header{ background:linear-gradient(90deg,#0F2335 0%,#173550 100%); color:#EFE9DA; position:sticky; top:0; z-index:40; height:var(--top-h); display:flex; align-items:center; justify-content:space-between; gap:10px; padding:0 18px; box-shadow:0 1px 0 rgba(255,255,255,.04), 0 8px 24px -16px rgba(0,0,0,.6); }
      .cx-header .cx-date{ font-size:12.5px; opacity:.72; }
      .cx-user{ display:flex; align-items:center; gap:10px; }
      .cx-avatar{ width:34px; height:34px; border-radius:50%; background:linear-gradient(135deg,#C9A44A,#8F6C1C); color:#1B1405; display:grid; place-items:center; font-weight:700; font-size:14px; flex:none; }
      .cx-icon-btn{ width:36px; height:36px; border-radius:10px; display:inline-grid; place-items:center; background:rgba(255,255,255,.06); color:#EFE9DA; border:1px solid rgba(255,255,255,.12); cursor:pointer; transition:background .15s; }
      .cx-icon-btn:hover{ background:rgba(255,255,255,.14); }
      .cx-nav{ display:flex; gap:2px; }
      .cx-tab{ display:flex; align-items:center; gap:10px; background:transparent; border:none; cursor:pointer; color:var(--muted); font-size:14px; font-weight:500; white-space:nowrap; border-radius:10px; padding:10px 12px; position:relative; transition:background .15s,color .15s; text-align:start; }
      .cx-tab svg{ flex:none; }
      .cx-tab[data-tab=board] svg{ color:#1F6B66; } .cx-tab[data-tab=ledger] svg{ color:#A86A0B; } .cx-tab[data-tab=bookings] svg{ color:#5B4BA6; }
      .cx-tab[data-tab=reports] svg{ color:#2F7A4F; } .cx-tab[data-tab=activity] svg{ color:#3D5A73; } .cx-tab[data-tab=users] svg{ color:#A63D63; }
      .cx-tab:hover{ background:var(--paper2); color:var(--ink); }
      .cx-tab.active{ background:var(--gold-soft); color:var(--ink); font-weight:700; }
      .cx-tab .cx-badge{ margin-inline-start:auto; background:var(--rust); color:#fff; border-radius:999px; padding:0 7px; font-size:11.5px; font-weight:700; line-height:20px; min-width:20px; text-align:center; }
      .cx-main{ min-width:0; }
      .cx-page{ padding:16px 22px 32px; }
      @media screen and (max-width:1023.98px){ .cx-page{ padding:14px 12px 24px; } }
      .cx-page-head{ display:flex; align-items:flex-end; justify-content:space-between; gap:12px; flex-wrap:wrap; padding:22px 22px 4px; }
      .cx-page-head h1{ margin:0; font-size:22px; font-weight:700; color:var(--ink); letter-spacing:-.01em; }
      .cx-page-head p{ margin:2px 0 0; color:var(--muted); font-size:13px; }
      @media screen and (min-width:1024px){
        .cx-shell{ display:grid; grid-template-columns:var(--nav-w) 1fr; grid-template-rows:var(--top-h) 1fr; }
        .cx-shell > .cx-header{ grid-column:1 / -1; }
        .cx-nav{ flex-direction:column; padding:14px 12px; background:var(--surface); border-inline-end:1px solid var(--hair); position:sticky; top:var(--top-h); height:calc(100vh - var(--top-h)); overflow:auto; }
        .cx-nav-title{ font-size:11px; letter-spacing:.12em; color:var(--faint); padding:6px 12px 8px; font-weight:600; }
        .cx-tab.active::before{ content:""; position:absolute; inset-inline-start:-12px; top:8px; bottom:8px; width:3px; border-radius:3px; background:var(--gold); }
      }
      @media screen and (max-width:1023.98px){
        .cx-nav{ position:fixed; bottom:0; inset-inline:0; z-index:45; background:rgba(255,255,255,.97); backdrop-filter:blur(10px); border-top:1px solid var(--hair); padding:6px 6px calc(6px + env(safe-area-inset-bottom)); justify-content:space-around; overflow-x:auto; box-shadow:0 -10px 24px -18px rgba(20,32,43,.4); }
        .cx-nav-title{ display:none; }
        .cx-tab{ flex-direction:column; gap:3px; font-size:11px; padding:6px 8px; min-width:58px; align-items:center; border-radius:10px; }
        .cx-tab.active{ background:var(--gold-soft); }
        .cx-tab .cx-badge{ position:absolute; top:2px; inset-inline-end:6px; margin:0; font-size:10px; line-height:16px; min-width:16px; padding:0 4px; }
        .cx-main{ padding-bottom:84px; }
        .cx-header{ padding:0 12px; }
        .cx-header .cx-date, .cx-user-meta{ display:none; }
        .cx-page-head{ padding:16px 14px 0; }
        .cx-page-head h1{ font-size:19px; }
      }

      /* ---------- icon chips & motion ---------- */
      .cx-ico{ width:40px; height:40px; border-radius:12px; display:inline-grid; place-items:center; flex:none; }
      .cx-ico.sm{ width:30px; height:30px; border-radius:9px; }
      .ic-green{ background:#E3F2E8; color:#2F7A4F; } .ic-red{ background:#FBE6E1; color:#B4452E; } .ic-indigo{ background:#ECE9F8; color:#5B4BA6; }
      .ic-amber{ background:#FDF0D5; color:#A86A0B; } .ic-teal{ background:#DFF0EE; color:#1F6B66; } .ic-slate{ background:#E7EDF3; color:#3D5A73; }
      .ic-rose{ background:#FBE7EE; color:#A63D63; } .ic-gold{ background:var(--gold-soft); color:var(--gold-d); }
      .cx-page{ animation:cx-page .25s ease-out; }
      @keyframes cx-page{ from{ transform:translateY(8px); } to{ transform:none; } }
      .cx-sec-head{ display:flex; align-items:center; gap:12px; margin-bottom:12px; }
      .cx-sec-head h3{ margin:0; font-size:16px; font-weight:700; color:var(--ink); }
      .cx-sec-head p{ margin:1px 0 0; font-size:13px; color:var(--muted); }
      .cx-meta{ display:flex; flex-wrap:wrap; gap:6px 14px; color:var(--muted); font-size:13.5px; }
      .cx-meta > span{ display:inline-flex; align-items:center; gap:5px; }
      .cx-meta svg{ color:var(--faint); }
      .cx-spinner{ width:30px; height:30px; border-radius:50%; border:3px solid var(--hair); border-top-color:var(--gold); animation:cx-spin .8s linear infinite; margin:0 auto 12px; }
      @keyframes cx-spin{ to{ transform:rotate(360deg); } }
      @media (prefers-reduced-motion: reduce){ .cx-page, .cx-toast, .cx-panel{ animation:none !important; } .cx-tile{ transition:none; } }

      /* ---------- surfaces ---------- */
      .cx-card{ background:var(--surface); border:1px solid var(--hair); border-radius:var(--r); box-shadow:var(--sh); }
      .cx-kpi{ background:var(--surface); border:1px solid var(--hair); border-radius:var(--r); padding:14px 16px; box-shadow:var(--sh); position:relative; overflow:hidden; }
      .cx-section-title{ font-size:15px; font-weight:700; color:var(--ink); margin:0 0 2px; }
      .cx-hint{ font-size:12.5px; color:var(--muted); }
      .cx-toolbar{ display:flex; gap:10px; flex-wrap:wrap; align-items:center; background:var(--surface); border:1px solid var(--hair); border-radius:var(--r); padding:10px; box-shadow:var(--sh); }
      details > summary{ list-style:none; }
      details > summary::-webkit-details-marker{ display:none; }
      details > summary::before{ content:"‹"; display:inline-block; margin-inline-end:8px; transition:transform .15s; color:var(--faint); font-weight:700; }
      details[open] > summary::before{ transform:rotate(-90deg); }

      /* ---------- form controls ---------- */
      .cx-input, .cx-select, .cx-textarea{ background:#fff; border:1px solid #D9D2C2; border-radius:var(--r-s); padding:8px 11px; font-family:inherit; color:var(--text); font-size:14px; width:100%; min-height:40px; transition:border-color .15s, box-shadow .15s; }
      textarea.cx-input{ padding-top:9px; }
      .cx-input:hover, .cx-select:hover, .cx-textarea:hover{ border-color:#C7BEAB; }
      .cx-input:focus, .cx-select:focus, .cx-textarea:focus{ outline:none; border-color:var(--gold); box-shadow:0 0 0 3px rgba(184,145,47,.18); }
      .cx-input:disabled, .cx-select:disabled, .cx-textarea:disabled{ background:#F7F5F0; color:#6E685D; cursor:not-allowed; }
      .cx-select{ appearance:none; -webkit-appearance:none; padding-inline-start:26px; background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%235F5A50' stroke-width='2.4'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E"); background-repeat:no-repeat; background-position:left 8px center; }
      .calma-app label{ color:var(--muted); font-weight:500; }
      .calma-app input[type=checkbox]{ width:17px; height:17px; accent-color:var(--gold-d); vertical-align:middle; }
      .calma-app :focus-visible{ outline:2px solid var(--gold); outline-offset:2px; }

      /* ---------- buttons ---------- */
      .cx-btn{ border-radius:var(--r-s); padding:9px 16px; min-height:40px; font-weight:600; font-size:14px; cursor:pointer; border:1px solid transparent; display:inline-flex; align-items:center; justify-content:center; gap:7px; transition:background .15s,border-color .15s,box-shadow .15s,transform .05s; white-space:nowrap; }
      .cx-btn:active{ transform:translateY(1px); }
      .cx-btn-gold{ background:var(--gold); color:#21190A; box-shadow:0 1px 0 rgba(255,255,255,.3) inset, 0 4px 12px -6px rgba(151,116,32,.7); }
      .cx-btn-gold:hover{ background:#A9852A; }
      .cx-btn-outline{ background:#fff; border-color:#D9D2C2; color:var(--ink); }
      .cx-btn-outline:hover{ background:var(--paper); border-color:#C7BEAB; }
      .cx-btn-danger{ background:#fff; border-color:#E4B5AA; color:var(--rust); }
      .cx-btn-danger:hover{ background:var(--bad-bg); }
      .cx-btn:disabled{ opacity:0.45; cursor:not-allowed; transform:none; }
      .cx-pill{ border-radius:999px; padding:3px 10px; font-size:12.5px; font-weight:600; display:inline-flex; align-items:center; gap:5px; line-height:1.5; }

      /* ---------- tables ---------- */
      table.cx-table{ border-collapse:separate; border-spacing:0; width:100%; background:#fff; border:1px solid var(--hair); border-radius:var(--r); overflow:hidden; }
      table.cx-table td, table.cx-table th{ border-bottom:1px solid var(--hair2); border-inline-start:1px solid var(--hair2); padding:8px 9px; vertical-align:middle; }
      table.cx-table tr > :first-child{ border-inline-start:none; }
      table.cx-table tbody tr:last-child td{ border-bottom:none; }
      table.cx-table tbody tr:hover td{ background:#FCFBF8; }
      .cx-th{ position:sticky; top:0; background:#F4F1E9; color:var(--muted); font-weight:600; font-size:12.5px; text-align:start; z-index:1; }

      /* ---------- feedback ---------- */
      .cx-toast{ position:fixed; top:calc(var(--top-h) + 14px); left:50%; transform:translateX(-50%); background:var(--ink); color:#fff; padding:12px 18px; border-radius:12px; font-size:14px; z-index:90; max-width:min(560px, calc(100vw - 24px)); box-shadow:var(--sh-l); line-height:1.6; animation:cx-in .2s ease-out; border-inline-start:4px solid var(--gold); }
      @keyframes cx-in{ from{ opacity:0; transform:translate(-50%,-8px); } to{ opacity:1; transform:translate(-50%,0); } }

      /* ---------- room board ---------- */
      .cx-board{ display:grid; grid-template-columns:1fr; gap:16px; align-items:start; }
      @media screen and (min-width:1024px){ .cx-board.has-panel{ grid-template-columns:minmax(0,1fr) minmax(380px,460px); } }
      @media screen and (min-width:1400px){ .cx-board.has-panel{ grid-template-columns:minmax(0,1fr) minmax(440px,540px); } }
      .cx-tiles{ display:grid; grid-template-columns:repeat(auto-fill,minmax(150px,1fr)); gap:12px; }
      .cx-tile{ border:1px solid var(--hair); border-radius:14px; background:#fff; padding:12px 12px 11px; cursor:pointer; transition:transform .12s, box-shadow .15s, border-color .15s; box-shadow:var(--sh); position:relative; overflow:hidden; min-height:96px; display:flex; flex-direction:column; gap:2px; }
      .cx-tile::before{ content:""; position:absolute; inset-inline:0; top:0; height:4px; background:var(--st,#999); }
      .cx-tile:hover{ transform:translateY(-2px); box-shadow:var(--sh-l); }
      .cx-tile.selected{ border-color:var(--gold); box-shadow:0 0 0 3px rgba(184,145,47,.28), var(--sh); }
      .cx-tile .cx-tile-st{ font-size:11.5px; font-weight:600; color:var(--st,#666); display:flex; align-items:center; gap:5px; }
      .cx-tile .cx-tile-st::before{ content:""; width:7px; height:7px; border-radius:50%; background:var(--st,#999); }
      .cx-legend{ display:flex; gap:8px; flex-wrap:wrap; }
      .cx-legend [role=radio]{ cursor:pointer; border:1px solid transparent; user-select:none; }
      .cx-legend [role=radio][aria-checked=true]{ border-color:currentColor; box-shadow:0 0 0 2px rgba(0,0,0,.04); }
      .cx-panel{ position:sticky; top:calc(var(--top-h) + 14px); max-height:calc(100vh - var(--top-h) - 28px); overflow:auto; }
      @media screen and (max-width:1023.98px){
        .cx-panel{ position:fixed; inset:0; top:var(--top-h); max-height:none; z-index:44; border-radius:18px 18px 0 0 !important; margin:0 !important; padding-bottom:96px !important; animation:cx-up .22s ease-out; }
        @keyframes cx-up{ from{ transform:translateY(24px); opacity:.4; } to{ transform:none; opacity:1; } }
      }
      .cx-panel-head{ position:sticky; top:-16px; background:#fff; margin:-16px -16px 0; padding:14px 16px 12px; border-bottom:1px solid var(--hair2); z-index:2; display:flex; justify-content:space-between; align-items:center; gap:8px; }

      /* ---------- segmented / forms / lists ---------- */
      .cx-seg{ display:inline-flex; flex-wrap:wrap; gap:0; background:var(--surface); border:1px solid var(--hair); border-radius:12px; padding:3px; box-shadow:var(--sh); }
      .cx-seg .cx-btn{ border:none; box-shadow:none; min-height:36px; padding:6px 14px; font-size:13.5px; background:transparent; color:var(--muted); }
      .cx-seg .cx-btn.cx-btn-gold{ background:var(--ink); color:#fff; }
      .cx-form label, .cx-page label{ display:inline-block; margin-bottom:4px; }
      .cx-form > div + div{ margin-top:2px; }
      .cx-bk:hover{ border-color:#D8CFBC; }
      [data-testid=money-box]{ border:1px solid var(--hair2); }
      .cx-page details[data-testid] > summary{ padding:4px 0; font-size:14px !important; }
      @media screen and (max-width:760px){
        table.cx-table.cx-stack{ min-width:0 !important; border:none; background:transparent; }
        table.cx-stack thead{ display:none; }
        table.cx-stack, table.cx-stack tbody, table.cx-stack tr, table.cx-stack td{ display:block; width:100%; }
        table.cx-stack tr{ background:#fff; border:1px solid var(--hair); border-radius:14px; margin-bottom:12px; box-shadow:var(--sh); overflow:hidden; }
        table.cx-stack td{ border:none !important; border-bottom:1px solid var(--hair2) !important; position:static !important; padding:10px 12px !important; }
        table.cx-stack td:last-child{ border-bottom:none !important; }
        table.cx-stack td[data-label]::before{ content:attr(data-label); display:block; font-size:12px; color:var(--faint); font-weight:600; margin-bottom:6px; }
        table.cx-stack td:first-child{ background:var(--paper2) !important; text-align:start !important; font-size:15px; }
        table.cx-stack td:first-child::before{ display:none; }
      }
      /* ---------- booking form steps ---------- */
      .cx-form-grid{ display:grid; grid-template-columns:1fr; gap:18px; align-items:start; }
      @media screen and (min-width:1100px){ .cx-form-grid{ grid-template-columns:minmax(0,1fr) 300px; } .cx-form-side{ position:sticky; top:calc(var(--top-h) + 16px); } }
      .cx-step{ position:relative; padding-inline-start:46px; padding-bottom:20px; }
      .cx-step::before{ content:""; position:absolute; inset-inline-start:15px; top:34px; bottom:4px; width:2px; background:var(--hair); border-radius:2px; }
      .cx-step:last-child::before{ display:none; }
      .cx-step-head{ display:flex; gap:12px; align-items:flex-start; margin-inline-start:-46px; margin-bottom:12px; }
      .cx-step-num{ width:32px; height:32px; border-radius:50%; flex:none; display:grid; place-items:center; font-weight:700; font-size:14px; background:#fff; border:2px solid var(--gold); color:var(--gold-d); position:relative; z-index:1; transition:background .2s,color .2s; }
      .cx-step-num.done{ background:var(--sage); border-color:var(--sage); color:#fff; }
      .cx-step-title{ font-size:15.5px; font-weight:700; color:var(--ink); display:flex; align-items:center; gap:8px; }
      .cx-step-opt{ font-size:11.5px; font-weight:600; color:var(--muted); background:var(--paper2); border-radius:999px; padding:1px 8px; }
      .cx-form-side{ background:linear-gradient(180deg,#FFFDF7,#FBF6E9); border:1px solid #EADDB8; border-radius:var(--r); padding:16px; }
      .cx-sum{ margin:0 0 14px; display:grid; gap:7px; }
      .cx-sum > div{ display:flex; justify-content:space-between; gap:10px; font-size:13.5px; }
      .cx-sum > div.sep{ border-top:1px dashed #E1D3AE; padding-top:9px; margin-top:3px; }
      .cx-sum dt{ color:var(--muted); } .cx-sum dd{ margin:0; font-weight:700; color:var(--ink); text-align:end; overflow-wrap:anywhere; }
      .cx-steps-mini{ list-style:none; margin:0 0 14px; padding:12px 0 0; border-top:1px solid #EADDB8; display:grid; gap:7px; font-size:13px; color:var(--muted); }
      .cx-steps-mini li{ display:flex; align-items:center; gap:8px; }
      .cx-steps-mini li span{ width:20px; height:20px; border-radius:50%; display:grid; place-items:center; font-size:11px; font-weight:700; background:#fff; border:1px solid #D9CCA8; }
      .cx-steps-mini li.done{ color:var(--ink); } .cx-steps-mini li.done span{ background:var(--sage); border-color:var(--sage); color:#fff; }
      /* ---------- ledger sticky bar ---------- */
      .cx-anchor{ scroll-margin-top:150px; }
      .cx-ledbar{ position:sticky; top:calc(var(--top-h) + 8px); z-index:20; display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap; margin:0 0 14px; padding:8px 10px; background:rgba(255,255,255,.94); backdrop-filter:blur(10px); border:1px solid var(--hair); border-radius:var(--r); box-shadow:var(--sh-l); }
      .cx-ledbar-nav{ display:flex; gap:4px; overflow-x:auto; scrollbar-width:none; }
      .cx-ledbar-nav a{ display:inline-flex; align-items:center; gap:6px; padding:7px 12px; border-radius:10px; color:var(--muted); text-decoration:none; font-size:13.5px; font-weight:600; white-space:nowrap; transition:background .15s,color .15s; }
      .cx-ledbar-nav a:hover{ background:var(--paper); color:var(--ink); }
      .cx-ledbar-nav a.on{ background:var(--ink); color:#fff; }
      .cx-ledbar-end{ display:flex; align-items:center; gap:12px; margin-inline-start:auto; }
      .cx-ledbar-cash{ display:flex; flex-direction:column; line-height:1.25; text-align:end; }
      .cx-ledbar-cash span{ font-size:11.5px; color:var(--muted); } .cx-ledbar-cash b{ font-size:15px; color:var(--teal); }
      @media screen and (max-width:1023.98px){ .cx-ledbar{ top:calc(var(--top-h) + 4px); } .cx-ledbar-nav{ width:100%; } .cx-ledbar-end{ width:100%; justify-content:space-between; } }
      /* ---------- quick search (Ctrl+K) ---------- */
      .cx-search-btn{ display:flex; align-items:center; gap:10px; height:38px; padding:0 12px; border-radius:10px; background:rgba(255,255,255,.08); border:1px solid rgba(255,255,255,.14); color:rgba(239,233,218,.85); cursor:pointer; font-family:inherit; font-size:13.5px; min-width:260px; transition:background .15s; margin-inline:auto 14px; }
      .cx-search-btn:hover{ background:rgba(255,255,255,.14); }
      .cx-search-btn kbd, .cx-pal kbd{ font-family:inherit; font-size:11px; background:rgba(255,255,255,.12); border:1px solid rgba(255,255,255,.2); border-radius:6px; padding:1px 6px; margin-inline-start:auto; direction:ltr; }
      @media screen and (max-width:1023.98px){ .cx-search-btn{ min-width:0; width:38px; padding:0; justify-content:center; margin-inline:auto 6px; } .cx-search-txt, .cx-search-btn kbd{ display:none; } }
      .cx-pal-back{ position:fixed; inset:0; background:rgba(15,25,35,.45); backdrop-filter:blur(3px); z-index:100; display:flex; justify-content:center; align-items:flex-start; padding:12vh 12px 12px; animation:cx-fade .15s ease-out; }
      @keyframes cx-fade{ from{ opacity:0; } to{ opacity:1; } }
      .cx-pal{ width:min(620px,100%); background:#fff; border-radius:18px; box-shadow:0 30px 80px -20px rgba(0,0,0,.5); overflow:hidden; display:flex; flex-direction:column; max-height:72vh; }
      .cx-pal-in{ display:flex; align-items:center; gap:10px; padding:14px 16px; border-bottom:1px solid var(--hair2); color:var(--faint); }
      .cx-pal-in input{ flex:1; border:none; outline:none; font:inherit; font-size:16px; color:var(--text); background:transparent; min-width:0; }
      .cx-pal-in input:focus-visible{ outline:none; }
      .cx-pal kbd{ background:var(--paper2); border-color:var(--hair); color:var(--muted); margin:0 2px; }
      .cx-pal-list{ overflow:auto; padding:6px; }
      .cx-pal-group{ font-size:11.5px; font-weight:700; color:var(--faint); padding:10px 10px 4px; letter-spacing:.04em; }
      .cx-pal-item{ display:flex; align-items:center; gap:10px; padding:9px 10px; border-radius:10px; cursor:pointer; }
      .cx-pal-item[aria-selected=true]{ background:var(--gold-soft); }
      .cx-pal-item .t{ font-weight:600; color:var(--ink); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .cx-pal-item .s{ font-size:12.5px; color:var(--muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .cx-pal-empty{ padding:28px; text-align:center; color:var(--muted); }
      .cx-pal-foot{ display:flex; gap:16px; flex-wrap:wrap; padding:9px 16px; border-top:1px solid var(--hair2); font-size:12px; color:var(--muted); background:#FBFAF6; }

      /* ---------- today strip ---------- */
      .cx-today{ display:grid; grid-template-columns:repeat(auto-fit,minmax(240px,1fr)); gap:12px; margin-bottom:16px; }
      .cx-today-col{ padding:12px 14px; }
      .cx-today-head{ display:flex; align-items:center; gap:10px; margin-bottom:6px; }
      .cx-today-head b{ color:var(--ink); font-size:14.5px; }
      .cx-today-n{ margin-inline-start:auto; font-weight:700; font-size:18px; color:var(--ink); }
      .cx-today ul{ list-style:none; margin:0; padding:0; display:grid; gap:2px; }
      .cx-today li button{ width:100%; display:flex; align-items:center; gap:8px; background:transparent; border:none; border-radius:8px; padding:6px 6px; cursor:pointer; font:inherit; font-size:13.5px; color:var(--text); text-align:start; }
      .cx-today li button:hover{ background:var(--paper); }
      .cx-today li .r{ font-weight:700; color:var(--ink); white-space:nowrap; }
      .cx-today li .g{ flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--muted); }
      .cx-today li .d{ color:var(--rust); font-weight:700; white-space:nowrap; }
      /* ---------- round 5: empty states, bidi isolation, nav labels, soft buttons ---------- */
      .cx-empty{ display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; gap:8px; padding:34px 18px; background:var(--surface); border:1px dashed var(--hair); border-radius:var(--r); color:var(--muted); }
      .cx-empty.compact{ padding:20px 14px; gap:6px; }
      .cx-empty .cx-ico{ width:46px; height:46px; border-radius:14px; }
      .cx-empty.compact .cx-ico{ width:38px; height:38px; border-radius:12px; }
      .cx-empty-t{ font-weight:700; color:var(--ink); font-size:15px; }
      .cx-empty-h{ font-size:13px; color:var(--muted); max-width:420px; line-height:1.6; }
      .cx-iso{ unicode-bidi:isolate; }
      .cx-rn{ unicode-bidi:isolate; direction:ltr; }
      .cx-top-btn{ position:fixed; inset-inline-start:18px; bottom:22px; z-index:40; width:44px; height:44px; border-radius:14px; border:1px solid var(--hair); background:var(--surface); color:var(--ink); box-shadow:var(--sh-l); display:flex; align-items:center; justify-content:center; cursor:pointer; animation:cx-fade .15s ease-out; }
      .cx-top-btn:hover{ background:var(--paper); }
      @media screen and (max-width:1023.98px){ .cx-top-btn{ bottom:calc(84px + env(safe-area-inset-bottom)); inset-inline-start:12px; } }
      .cx-today li .r, .cx-today li .g, .cx-pal-item .t, .cx-pal-item .s{ unicode-bidi:isolate; }
      .cx-tab .lbl-short{ display:none; }
      .cx-btn-soft{ background:var(--gold-soft); color:#7A5A12; border:1px solid #E6D3A3; box-shadow:none; }
      .cx-btn-soft:hover{ background:#F3E6C4; }
      .cx-role{ display:inline-flex; align-items:center; gap:5px; font-size:12px; font-weight:700; padding:2px 9px; border-radius:999px; line-height:20px; }
      .cx-role.r-gm{ background:#FBF1DC; color:#8A6416; } .cx-role.r-staff{ background:#E5F2EC; color:#1E6B4E; }
      .cx-role.r-reservations{ background:#ECE7F6; color:#5B3F96; } .cx-role.r-accounts{ background:#E4EEF7; color:#2B5B86; }
      .cx-role.off{ background:#EFEEEC; color:#6E685D; }
      .cx-day-sep{ position:sticky; top:0; z-index:1; padding:7px 16px; font-size:12px; font-weight:700; color:var(--muted); background:#FAF8F3; border-top:1px solid var(--hair2); letter-spacing:.02em; }
      .cx-auth-feats{ display:flex; gap:10px; flex-wrap:wrap; }
      .cx-auth-feats span{ display:inline-flex; align-items:center; gap:8px; padding:8px 12px; border-radius:12px; background:rgba(255,255,255,.06); border:1px solid rgba(255,255,255,.1); font-size:13px; color:rgba(239,233,218,.85); }
      .cx-auth-feats svg{ color:#D6B25E; }
      @media screen and (max-width:1023.98px){
        .cx-tab .lbl-full{ display:none; } .cx-tab .lbl-short{ display:inline; }
        .cx-tab{ min-width:52px; padding:6px 4px; }
      }
      /* ---------- login ---------- */
      .cx-auth{ min-height:100vh; display:grid; grid-template-columns:1fr; }
      .cx-auth-brand{ display:none; }
      @media screen and (min-width:900px){
        .cx-auth{ grid-template-columns:minmax(0,1.05fr) minmax(0,1fr); }
        .cx-auth-brand{ display:flex; flex-direction:column; justify-content:space-between; padding:48px; color:#EFE9DA; background:radial-gradient(1200px 600px at 110% -10%, rgba(184,145,47,.35), transparent 60%), radial-gradient(800px 500px at -10% 110%, rgba(31,75,74,.55), transparent 60%), var(--ink); }
        .cx-auth-brand h2{ font-size:34px; line-height:1.25; margin:0 0 10px; font-weight:700; color:#fff; }
        .cx-auth-brand p{ color:rgba(239,233,218,.75); font-size:15px; margin:0; max-width:420px; }
      }
      .cx-auth-form{ display:flex; align-items:center; justify-content:center; padding:24px 16px; }
      .cx-auth-form .cx-card{ box-shadow:var(--sh-l); }
      ::placeholder{ color:#B3AA97; }
      .cx-print-only{ display:none; }
      ${PRINT_FIT_CSS}

      /* ========== شكل الطباعة الاحترافي (تقرير اليومية/الفترة) ========== */
      @media print{
        @page{ size:A4; margin:14mm 12mm; }
        html, body{ background:#fff !important; }
        .calma-app{ background:#fff !important; color:#161D27 !important; }
        .cx-no-print{ display:none !important; }
        .cx-print-only{ display:block !important; }
        .cx-header, .cx-tab, .cx-toast{ display:none !important; }
        .cx-shell{ display:block !important; }
        .cx-nav, .cx-page-head{ display:none !important; }
        .cx-main{ padding:0 !important; }
        .cx-board{ display:block !important; }
        .cx-panel{ position:static !important; max-height:none !important; }

        .cx-print-header{ margin-bottom:10px; }
        .cx-print-head-row{ display:flex; justify-content:space-between; align-items:flex-start; gap:12px; }
        .cx-print-brand{ display:flex; align-items:center; gap:8px; }
        .cx-print-hotel-name{ font-family:'Fraunces',serif; font-style:italic; font-size:15px; color:#161D27; }
        .cx-print-meta{ text-align:left; font-size:11px; color:#3D4650; line-height:1.6; }
        .cx-print-title{ font-weight:800; font-size:14px; color:#161D27; }
        .cx-print-rule{ height:2px; background:linear-gradient(90deg,#B8912F,rgba(184,145,47,0)); margin:8px 0 14px; }
        .cx-print-footer{ margin-top:26px; }
        .cx-print-sign{ display:flex; justify-content:space-between; font-size:11px; color:#3D4650; border-top:1px dashed #999; padding-top:10px; margin-top:18px; }
        .cx-print-generated{ text-align:center; font-size:9.5px; color:#8A8273; margin-top:6px; }

        .cx-card{ box-shadow:none !important; border:1px solid #BBB !important; border-radius:6px !important; break-inside:avoid; page-break-inside:avoid; background:#fff !important; }
        .cx-kpi{ background:#fff !important; border:1px solid #BBB !important; }
        .cx-report-grid{ grid-template-columns:repeat(4,1fr) !important; gap:8px !important; }
        table.cx-table{ font-size:10.5px; }
        table.cx-table thead{ display:table-header-group; }
        table.cx-table th.cx-th{ background:#F0EDE2 !important; -webkit-print-color-adjust:exact; print-color-adjust:exact; position:static !important; }
        /* الـ sticky في الطباعة بيزحزح ترويسة الجدول وبيغطي الصفوف */
        ::placeholder{ color:transparent !important; }
        td[style*="sticky"]{ position:static !important; }
        table.cx-table{ min-width:0 !important; width:100% !important; }
        table.cx-table tr{ break-inside:avoid; page-break-inside:avoid; }
        * { -webkit-print-color-adjust:exact; print-color-adjust:exact; }

        /* أي حقل إدخال (ليفل اليومية، نموذج الحجوزات، إلخ) بيتحول شكله وقت
           الطباعة لنص عادي بدل مربع فورم - عشان كل ورقة مطبوعة في السيستم،
           مش بس شاشة التقارير، تطلع بشكل ورقة رسمية موحّدة. */
        .cx-input, .cx-select, .cx-textarea{ border:none !important; background:transparent !important; padding:1px 2px !important; color:#161D27 !important; -webkit-appearance:none; appearance:none; }
        .cx-input:disabled, .cx-select:disabled, .cx-textarea:disabled{ color:#161D27 !important; -webkit-text-fill-color:#161D27 !important; opacity:1 !important; }

        /* أي صندوق فيه قص/سكرول (قوائم طويلة، جداول عريضة) لازم يبان كامل
           في الورقة المطبوعة - السكرول مفهوم بس على الشاشة. */
        [style*="overflow"]{ overflow:visible !important; max-height:none !important; }
      }
    `}</style>
  );
}

/* حرفين من الاسم للصورة الرمزية (من غير "ال" في أول الكلمة) */
export function initials(name) {
  return String(name || "?").trim().split(/\s+/).slice(0, 2).map((w) => w.replace(/^ال(?=..)/, "")[0] || "").join("") || "?";
}

/* اسم الغرفة زي ما اتكتب بالظبط (مثلاً "601(t)داخلي"): الأسامي فيها أرقام وحروف إنجليزي وعربي مع بعض،
   فلو اتعرضت جوه جملة عربي المتصفح بيعيد ترتيبها ("(t)601داخلي"). بنعزلها كاتجاه شمال-لليمين فبتظهر
   بنفس ترتيب كتابتها. النص نفسه مابيتغيّرش (بحث/نسخ/اختبارات زي ما هي). */
export function RoomName({ rooms, number, prefix = true }) {
  const { ltr, word } = roomDisplay(rooms, number);
  return <>{prefix ? "غرفة " : null}<bdi dir="ltr" className="cx-rn">{ltr}</bdi>{word ? " " + word : null}</>;
}
/* نفس الفكرة لأماكن مينفعش فيها عناصر (زي <option>): علامات عزل يونيكود حوالين الجزء الإنجليزي */
export const roomOptionLabel = (rooms, number) => roomLabel(rooms, number);
export const roomShortLabel = (rooms, number) => { const { ltr, word } = roomDisplay(rooms, number); return `\u2066${ltr}\u2069${word ? " " + word : ""}`; };

/* التواريخ (2026-10-25) جوه جملة عربي المتصفح بيعرض أجزاءها بالعكس (25-10-2026) - بنعزلها شمال-لليمين.
   الفترة بتتقري من البداية للنهاية: "2026-10-25 → 2026-10-28". النص نفسه مابيتغيّرش. */
export function DateRange({ from, to }) {
  return <bdi dir="ltr" className="cx-rn">{from} → {to}</bdi>;
}

/* زرار "لفوق" بيظهر بس لما الصفحة تطول وتنزل تحت (اليومية والحجوزات والتقارير بيبقوا طوال) */
export function BackToTop() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const on = () => setShow(window.scrollY > 700);
    on(); window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  if (!show) return null;
  return (
    <button type="button" className="cx-top-btn cx-no-print" aria-label="ارجع لأول الصفحة" title="ارجع لأول الصفحة"
      onClick={() => window.scrollTo({ top: 0, behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" })}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m18 15-6-6-6 6" /></svg>
    </button>
  );
}

/* حالة "مفيش حاجة": أيقونة هادية + جملة واضحة + (اختياري) سطر مساعدة أو زرار */
export function EmptyState({ icon: Icon, title, hint, children, tone = "slate", compact }) {
  return (
    <div className={"cx-empty" + (compact ? " compact" : "")} role="status">
      {Icon && <span className={"cx-ico ic-" + tone} aria-hidden="true"><Icon size={compact ? 18 : 22} /></span>}
      <div className="cx-empty-t">{title}</div>
      {hint && <div className="cx-empty-h">{hint}</div>}
      {children}
    </div>
  );
}

export function LoadingScreen({ inline }) {
  return <div role="status" style={{ padding: inline ? "3rem 1rem" : "6rem 1rem", textAlign: "center", color: "var(--muted)" }}><div className="cx-spinner" aria-hidden="true" />جارِ التحميل...</div>;
}

/* عنوان قسم موحّد: أيقونة ملوّنة + عنوان + وصف قصير */
export function SectionHead({ icon: Icon, tone = "gold", title, hint, children }) {
  return (
    <div className="cx-sec-head">
      {Icon && <span className={"cx-ico sm ic-" + tone} aria-hidden="true"><Icon size={17} /></span>}
      <div style={{ flex: 1, minWidth: 0 }}><h3>{title}</h3>{hint && <p>{hint}</p>}</div>
      {children}
    </div>
  );
}

export function ConfigWarningBanner() {
  return (
    <div style={{ position: "fixed", bottom: 0, insetInlineStart: 0, insetInlineEnd: 0, background: "#A8503B", color: "#fff", padding: "10px 16px", fontSize: 13.5, textAlign: "center", zIndex: 60 }}>
      ⚠ السيستم مش متوصل بقاعدة البيانات لسه - راجع ملف .env زي ما موضح في README.md
    </div>
  );
}

export function SchemaOutdatedBanner({ version, required, isAdmin }) {
  return (
    <div className="cx-no-print" data-testid="schema-outdated-banner" style={{ background: "#A8503B", color: "#fff", padding: "10px 16px", fontSize: 14, fontWeight: 700, textAlign: "center", position: "sticky", top: 0, zIndex: 70 }}>
      ⚠ قاعدة البيانات لسه على نسخة قديمة ({version || 0} من {required}) - تسجيل الدفع والكافيتيريا ورد الفلوس مش هيشتغلوا لحد ما يتحدّثوا.
      {isAdmin ? " شغّل ملف supabase/schema.sql كامل في Supabase (SQL Editor) وبعدين اعمل تحديث للصفحة." : " بلّغ المدير العام يحدّث قاعدة البيانات."}
    </div>
  );
}

export function Logo({ size = 34, light = false }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="19" fill="none" stroke="#B8912F" strokeWidth="1.4" /><text x="20" y="27" textAnchor="middle" fontFamily="Fraunces, serif" fontStyle="italic" fontSize="20" fill={light ? "#D9B65C" : "#1F4B4A"}>C</text></svg>
      <span className="cx-logo" style={{ fontSize: size * 0.62 }}>Calma</span>
    </div>
  );
}

export function TwoStepButton({ label, confirmLabel = "تأكيد؟", onConfirm, className = "cx-btn-danger", icon }) {
  const [confirming, setConfirming] = useState(false);
  if (confirming) return (<span style={{ display: "inline-flex", gap: 4 }}><button className="cx-btn cx-btn-danger" onClick={() => { setConfirming(false); onConfirm(); }}>{confirmLabel}</button><button className="cx-btn cx-btn-outline" onClick={() => setConfirming(false)}>إلغاء</button></span>);
  return <button className={"cx-btn " + className} onClick={() => setConfirming(true)}>{icon}{label}</button>;
}

/* خانات تفاصيل الدفع حسب الوسيلة (نفس الشكل في اليومية وبلوك الغرف وفورم الحجز):
   - فيزا: آخر 4 أرقام الكارت بس.
   - فودافون كاش / انستاباي / تحويل بنكي: اسم المرسل + رقم التليفون.
   - كاش: مفيش تفاصيل. */
export function PaymentDetailsInline({ method, details, onChange, disabled, compact = true, testid }) {
  if (!ONLINE_METHODS.includes(method)) return compact ? <span style={{ fontSize: 12.5, color: "var(--muted)" }}>—</span> : null;
  const d = { ...emptyPaymentDetails(), ...(details || {}) };
  const st = compact ? { fontSize: 12.5, padding: "4px 6px" } : undefined;
  if (isVisaMethod(method)) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 110 }}>
        <input className="cx-input" style={st} dir="ltr" inputMode="numeric" maxLength={4} placeholder="آخر 4 أرقام الكارت" aria-label="آخر 4 أرقام الكارت" data-testid={testid ? testid + "-last4" : undefined} disabled={disabled}
          value={d.senderNumber} onChange={(e) => onChange({ ...d, senderName: "", ref: "", senderNumber: normalizeLast4(e.target.value) })} />
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 120 }}>
      <AutoText className="cx-input" style={st} placeholder="اسم المرسل" aria-label="اسم المرسل" data-testid={testid ? testid + "-name" : undefined} disabled={disabled} value={d.senderName} onChange={(e) => onChange({ ...d, ref: "", senderName: e.target.value })} />
      <input className="cx-input" style={st} dir="ltr" inputMode="tel" placeholder="رقم التليفون" aria-label="رقم التليفون" data-testid={testid ? testid + "-phone" : undefined} disabled={disabled} value={d.senderNumber} onChange={(e) => onChange({ ...d, ref: "", senderNumber: normalizePhone(e.target.value) })} />
    </div>
  );
}

/* حساب الحجز في سطر واحد واضح (نفس الشكل في لوحة الغرف وقايمة الحجوزات):
   الإجمالي | المدفوع | المتبقي (أو "مستحق رده" لو فيه فلوس زيادة). */
/* عملة الدفعة: الموظف بيختار بنفسه (الافتراضي عملة الحجز). لو عملة تانية بيكتب سعر الصرف وقت الدفع
   (١ عملة الحجز = كام من عملة الدفعة)، وبيشوف المقابل اللي هيتخصم من المتبقي قبل ما يسجّل. */
export function fxPreview({ amount, currency, rate, bookingCurrency, due }) {
  if (!currency || currency === bookingCurrency) return null;
  const r = Number(rate) || 0;
  const amt = amount === "" || amount == null ? (r > 0 ? Math.round(due * r * 100) / 100 : 0) : Number(amount) || 0;
  const covered = r > 0 ? Math.round((amt / r) * 100) / 100 : 0;
  return { amt, rate: r, covered };
}
export function PayCurrencyFields({ bookingCurrency, currency, rate, onChange, amount, due, testid = "pay" }) {
  const cur = currency || bookingCurrency;
  const pv = fxPreview({ amount, currency: cur, rate, bookingCurrency, due });
  return (
    <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
      <select className="cx-select" aria-label="عملة الدفعة" data-testid={testid + "-currency"} style={{ width: 92, fontSize: 13 }} value={cur} onChange={(e) => onChange({ currency: e.target.value === bookingCurrency ? "" : e.target.value, rate: "" })}>
        {[...new Set([bookingCurrency, ...COMMON_CURRENCIES])].map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
      {cur !== bookingCurrency && (
        <span style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 13, background: "var(--gold-soft)", borderRadius: 8, padding: "4px 8px" }}>
          <span dir="ltr">1 {bookingCurrency} =</span>
          <input className="cx-input" data-testid={testid + "-rate"} aria-label="سعر الصرف" type="number" min="0" step="any" placeholder="سعر الصرف" style={{ width: 96 }} value={rate} onChange={(e) => onChange({ currency: cur, rate: e.target.value })} />
          <span dir="ltr">{cur}</span>
          {pv && pv.rate > 0 && <b data-testid={testid + "-fx-preview"}>= {fmt(pv.covered)} {bookingCurrency} من المتبقي</b>}
        </span>
      )}
    </span>
  );
}

export function MoneyBox({ b }) {
  const total = bookingGrandTotal(b), paid = Number(b.amountPaid) || 0, due = bookingAmountDue(b);
  const online = !!b.paymentDetails?.onlinePaid;
  const cancelled = b.status === "ملغي";
  // الحالة بتتحسب لوحدها من المدفوع والإجمالي (مفيش علامة بتتعلّم بالإيد)
  const state = cancelled ? null : due > 0 ? { text: paid > 0 ? "دفع جزئي" : "لسه مدفعش", color: "var(--rust)" } : total > 0 || paid > 0 ? { text: "مدفوع بالكامل", color: "var(--sage)" } : null;
  const cells = [["الإجمالي", fmt(total), null]];
  if (online) cells.push(["مدفوع أونلاين (سعر الغرفة)", fmt(onlineRoomCovered(b)), "var(--sage)"]);
  if (!online || paid > 0 || due > 0) cells.push([online ? "المتحصّل في الفندق" : "المدفوع", fmt(paid), null]);
  if (b.status !== "ملغي" && (due > 0 || !online)) cells.push([online ? "المتبقي في الفندق (خدمات/دخول مبكر/تمديد)" : "المتبقي", fmt(due), due > 0 ? "var(--rust)" : "var(--sage)"]);
  return (
    <div data-testid="money-box" style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center", background: "#fff", borderRadius: 8, padding: "8px 12px" }}>
      {state && <span data-testid="pay-state" className="cx-pill" style={{ background: state.color === "var(--sage)" ? "#EAF2EC" : "#FBE2E4", color: state.color }}>{state.text}</span>}
      {cells.map(([label, val, color]) => (
        <div key={label}><div style={{ color: "var(--muted)", fontSize: 12 }}>{label}</div><div style={{ fontWeight: 800, color: color || "inherit" }}>{val} {b.currency}</div></div>
      ))}
    </div>
  );
}

/* المدفوع على الحجز مقسّم بالوسيلة وتفاصيلها (فيزا ****1234 / فودافون باسم المحوِّل...) - من اليومية نفسها */
export function PayBreakdown({ payments, currency }) {
  if (!payments || payments.length === 0) return null;
  return (
    <div data-testid="pay-breakdown" style={{ fontSize: 13, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
      <span style={{ color: "var(--muted)" }}>اتدفع بـ:</span>
      {payments.map((p, i) => {
        const d = describePaymentDetails(p.method, p.details);
        return <span key={i} className="cx-pill" style={{ background: "#fff", border: "1px solid var(--hair)", fontWeight: 600 }}>{p.method}{d ? <b dir="ltr" style={{ marginInlineStart: 6 }}>{d}</b> : null} · {p.fx ? <>{fmt(p.fx.amount)} {p.fx.currency} <span style={{ color: "var(--muted)", fontWeight: 500 }}>(= {fmt(p.amount)} {currency} بسعر {fmt(p.fx.rate)})</span></> : <>{fmt(p.amount)} {currency}</>}</span>;
      })}
    </div>
  );
}

/* حالة الفلوس لحجز ملغي (أو رد قديم اتعمل قبل ما الرد يتشال) - سطر واحد. مفيش رد فلوس تاني: المدفوع بيفضل في الفندق. */
export function RefundBox({ b }) {
  const rs = refundStatusOf(b);
  if (!rs || rs.kind === "pending") return null;
  return (
    <div className="cx-no-print" data-testid="refund-status" style={{ width: "100%", fontSize: 13, fontWeight: 700, color: rs.kind === "refunded" ? "var(--sage)" : "var(--muted)" }}>
      {rs.kind === "refunded" ? "✓ " : "• "}{rs.text}
    </div>
  );
}

/* أكواد الأفراد (كود لكل فرد في الحجز، مربوط بالغرفة اللي سكن فيها) - بتتعرض كشرايح صغيرة */
export function GuestCodeChips({ codes }) {
  if (!codes || !codes.length) return null;
  return (
    <div data-testid="guest-codes" style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
      {codes.map((g) => (
        <span key={g.seq} className="cx-pill" title={`كود الفرد ${g.seq}`} style={{ background: "#fff", border: "1px solid var(--hair)", fontSize: 13 }}>
          <span dir="ltr" style={{ fontFamily: "monospace", fontWeight: 700 }}>{g.code}</span>
          <span style={{ color: "var(--muted)", marginInlineStart: 6 }}>فرد {g.seq}</span>
        </span>
      ))}
    </div>
  );
}

/* نتيجة البحث بكود فرد: كل حجز اتسجّل فيه الكود ده والغرفة اللي سكن فيها (نزيل راجع = أكتر من غرفة) */
export function GuestCodeHits({ hits, rooms, onOpenRoom }) {
  if (!hits || !hits.length) return null;
  return (
    <div className="cx-card cx-no-print" data-testid="guest-code-result" style={{ padding: 12, marginBottom: 10, background: "#EEF5F0", borderColor: "var(--sage)" }}>
      {hits.map((h) => (
        <div key={h.booking.id + "-" + h.seq} data-testid="guest-code-hit" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", padding: "3px 0" }}>
          <span style={{ fontWeight: 800 }}>كود <span dir="ltr" style={{ fontFamily: "monospace" }}>{h.code}</span> ← فرد {h.seq} في <RoomName rooms={rooms} number={h.room} /></span>
          <span style={{ fontSize: 13.5 }}>{h.booking.guestName} · <DateRange from={h.booking.checkin} to={h.booking.checkout} /> · {h.booking.status}</span>
          {onOpenRoom && <button className="cx-btn cx-btn-outline" style={{ fontSize: 13 }} onClick={() => onOpenRoom(h.room)}>افتح الغرفة</button>}
        </div>
      ))}
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
