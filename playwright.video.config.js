import { defineConfig } from "@playwright/test";

/*
  تسجيل فيديوهات شرح السيستم (سيناريوهات كاملة على قاعدة بيانات Postgres حقيقية ومتصفح حقيقي).
  كل فيديو بيتحفظ في video-out/ وعليه شرح مكتوب لكل خطوة. مش جزء من الاختبارات العادية.

  لتشغيل: E2E_PG_ADMIN_URL=postgresql://user:pass@localhost:5432/postgres npm run test:video
*/
export default defineConfig({
  testDir: "e2e-video",
  globalSetup: "./e2e/globalSetup.js",
  outputDir: "video-out",
  timeout: 900_000,
  expect: { timeout: 10_000 },
  workers: 1,
  fullyParallel: false,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:4173",
    timezoneId: "Africa/Cairo",
    locale: "ar-EG",
    viewport: { width: 1280, height: 800 },
    actionTimeout: 30_000,
    video: { mode: "on", size: { width: 1280, height: 800 } },
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH, args: ["--no-sandbox"] } : {},
  },
  webServer: {
    command: "npm run build && npx vite preview --port 4173 --strictPort",
    url: "http://localhost:4173",
    reuseExistingServer: false,
    timeout: 180_000,
    env: { VITE_SUPABASE_URL: "http://fake-supabase.test", VITE_SUPABASE_ANON_KEY: "fake-anon-key" },
  },
});
