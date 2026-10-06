import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // "prompt" + تسجيل يدوي في main.jsx (virtual:pwa-register): لما ينزل
      // إصدار جديد بنفحصه كل دقيقة وبنطبّقه تلقائيًا (بدون ما حد يرفرش) في أول
      // لحظة مفيش فيها موظف في نص كتابة فورم/يومية - وإلا كانت الصفحة
      // هتتعمل ريلود فجأة وتضيّع اللي بيكتبه. "autoUpdate" القديم كان بيسجّل
      // الـ service worker بس من غير ما يعيد تحميل الصفحة المفتوحة، فالنسخة
      // القديمة كانت بتفضل شغالة لحد ما حد يرفرش بإيده.
      registerType: "prompt",
      injectRegister: false,
      workbox: { cleanupOutdatedCaches: true, clientsClaim: true },
      includeAssets: ["favicon.svg"],
      manifest: {
        name: "Calma Hotel System",
        short_name: "Calma",
        description: "نظام إدارة فندق Calma",
        theme_color: "#161D27",
        background_color: "#FBF9F4",
        display: "standalone",
        start_url: "/",
        dir: "rtl",
        lang: "ar",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
        ],
      },
    }),
  ],
  test: {
    environment: "node",
    globals: true,
    // src/src نسخة قديمة مكررة من المشروع - مش جزء من الاختبارات الفعلية
    exclude: ["node_modules/**", "dist/**", "src/src/**"],
  },
});
