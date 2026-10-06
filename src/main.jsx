import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import { registerSW } from "virtual:pwa-register";

/*
  من غير الـ Error Boundary ده، أي خطأ برمجي غير متوقع في أي جزء من الواجهة
  (حتى لو بسيط) كان هيخلي الشاشة كلها تبيّض من غير أي رسالة توضح للموظف
  إيه اللي حصل - ده تجربة مربكة جدًا في نظام شغال فعليًا بفلوس وحجوزات.
*/
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error("[Calma] خطأ غير متوقع:", error, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: "3rem 1.5rem", textAlign: "center", fontFamily: "Tajawal, sans-serif", direction: "rtl" }}>
          <h2 style={{ marginBottom: 10 }}>حصل خطأ غير متوقع</h2>
          <p style={{ color: "#6B6357", marginBottom: 20 }}>جرّب تحدّث الصفحة. لو المشكلة استمرت، كلّم المدير العام.</p>
          <button
            onClick={() => window.location.reload()}
            style={{ padding: "10px 22px", borderRadius: 8, background: "#B8912F", color: "#2B2109", fontWeight: 700, border: "none", cursor: "pointer" }}
          >
            تحديث الصفحة
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);

/*
  تحديث النسخة تلقائيًا من غير ريفرش يدوي: بنفحص وجود إصدار جديد كل دقيقة (وأول
  ما التاب يرجع يظهر أو النت يرجع)، ولما يتحمّل بنطبّقه فورًا - إلا لو فيه
  فورم مفتوح أو الموظف بيكتب في خانة أو فيه عملية حفظ شغالة أو تعديل لسه
  ما اتبعتش للسيرفر (data-calma-editing / window.__calmaPendingWrites / withBusy)، وقتها بنستنى ونحاول تاني كل ٥ ثواني عشان
  مانضيّعش اللي الموظف بيكتبه.
*/
let updateReady = false;
let retryTimer = null;
function tryApplyUpdate() {
  if (!updateReady) return;
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
  const el = document.activeElement;
  const typing = el && ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
  if (typing || document.querySelector("[data-calma-editing]") || window.__calmaPendingWrites || window.__calmaBusyCount > 0) { retryTimer = setTimeout(tryApplyUpdate, 5000); return; }
  updateReady = false;
  updateSW(true);
}
const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() { updateReady = true; tryApplyUpdate(); },
  onRegisteredSW(_url, registration) {
    if (!registration) return;
    const check = () => { registration.update().catch(() => {}); };
    setInterval(check, 60 * 1000);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") check(); });
    window.addEventListener("online", check);
  },
});
