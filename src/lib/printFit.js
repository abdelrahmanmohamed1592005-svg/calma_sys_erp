/*
  printFit: حقول الإدخال (<input>) مابتلفّش النص - فالبيان الطويل (اسم نزيل، بيان تحصيل، ملاحظة) بيتقصّ في
  الورقة المطبوعة. وقت الطباعة بنحط جنب كل حقل نصي نسخة نص عادي بتلفّ على أكتر من سطر وبنخفي الحقل، وبعد
  الطباعة بنرجّع كل حاجة. شغّال لأي شاشة (اليومية، الحجوزات، التقارير) من غير ما نلمس كل حقل لوحده.
*/
export const PRINT_FIT_CSS = `
  .cx-print-value{ display:none; }
  @media print{
    [data-print-hidden]{ display:none !important; }
    .cx-print-value{ display:block; white-space:pre-wrap; overflow-wrap:anywhere; word-break:break-word; line-height:1.5; padding:1px 2px; min-width:0; max-width:100%; flex:1 1 0; color:#161D27; }
    input[type=number]::-webkit-inner-spin-button, input[type=number]::-webkit-outer-spin-button{ -webkit-appearance:none; margin:0; }
    input[type=number]{ -moz-appearance:textfield; appearance:textfield; }
    [style*="text-overflow"]{ white-space:normal !important; text-overflow:clip !important; overflow:visible !important; }
  }
`;

const TEXT_TYPES = ["text", "search", "tel", "email", "url"];
const isTextField = (el) => el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && TEXT_TYPES.includes((el.getAttribute("type") || "text").toLowerCase()));

export function expandForPrint(root = document) {
  root.querySelectorAll("input,textarea").forEach((el) => {
    if (!isTextField(el) || !el.value || el.hasAttribute("data-print-hidden") || el.closest(".cx-no-print")) return;
    const cs = getComputedStyle(el);
    if (cs.display === "none") return;
    const span = document.createElement("span");
    span.className = "cx-print-value";
    span.setAttribute("data-print-clone", "1");
    span.textContent = el.value;
    span.style.direction = cs.direction;
    span.style.textAlign = cs.textAlign === "start" ? "" : cs.textAlign;
    el.insertAdjacentElement("afterend", span);
    el.setAttribute("data-print-hidden", "1");
  });
}

export function restoreAfterPrint(root = document) {
  root.querySelectorAll("[data-print-clone]").forEach((s) => s.remove());
  root.querySelectorAll("[data-print-hidden]").forEach((el) => el.removeAttribute("data-print-hidden"));
}

export function installPrintFit() {
  if (typeof window === "undefined" || window.__calmaPrintFit) return;
  window.__calmaPrintFit = true;
  window.addEventListener("beforeprint", () => expandForPrint());
  window.addEventListener("afterprint", () => restoreAfterPrint());
}
