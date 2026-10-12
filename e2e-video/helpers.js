// أدوات الفيديو: شرح مكتوب على الشاشة لكل خطوة + وقفات تخلّي المشاهد يلحق.
export { test, expect } from "../e2e/fixtures";
export * from "../e2e/ui";

/* شريط شرح فوق الشاشة (بيفضل لحد الشرح الجاي) */
export async function say(page, text, ms = 2200) {
  await page.evaluate((t) => {
    let d = document.getElementById("__cap");
    if (!d) {
      d = document.createElement("div"); d.id = "__cap";
      Object.assign(d.style, { position: "fixed", top: "6px", left: "50%", transform: "translateX(-50%)", zIndex: 99999, background: "rgba(22,29,39,.95)", color: "#fff", padding: "9px 18px", borderRadius: "10px", font: "700 17px Tajawal, sans-serif", maxWidth: "92vw", textAlign: "center", direction: "rtl", pointerEvents: "none", boxShadow: "0 4px 18px rgba(0,0,0,.35)", lineHeight: "1.5" });
      document.body.appendChild(d);
    }
    d.textContent = t;
  }, text);
  await page.waitForTimeout(ms);
}
export const pause = (page, ms = 1200) => page.waitForTimeout(ms);
export async function users(env) {
  await env.seedUser("boss", "gm", "المدير العام");
  await env.seedUser("ahmed", "staff", "أحمد");
  await env.seedUser("sara", "staff", "سارة");
  await env.seedUser("rawan", "reservations", "روان");
  await env.seedUser("mona", "accounts", "منى");
}
export const dbBooking = async (env, guest) => (await env.q("select * from bookings where guest_name = $1", [guest]))[0];
