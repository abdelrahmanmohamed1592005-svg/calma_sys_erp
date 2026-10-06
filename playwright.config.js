import { defineConfig } from "@playwright/test";

/*
  اختبارات المتصفح (E2E): بتشغّل التطبيق المبني فعلاً في Chromium حقيقي، لكن
  من غير أي اتصال بـ Supabase حقيقي - e2e/fakeSupabase.js بيحاكي واجهة Supabase
  (الدخول + REST + الـ Edge Functions) جوه المتصفح نفسه. يعني الاختبارات دي
  آمنة تتشغّل في أي وقت ومش بتلمس بياناتك. التطبيق بيتبني هنا بعنوان
  Supabase وهمي (مش بيقرا .env بتاعك) فمستحيل يوصل لمشروعك الحقيقي.

  لتشغيل: npm run test:e2e
  لو Chromium مش متثبّت: npx playwright install chromium
  أو حدد مساره بنفسك: PW_CHROMIUM_PATH=/path/to/chrome npm run test:e2e
*/
export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/globalSetup.js",
  timeout: 30_000,
  expect: { timeout: 7_000 },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:4173",
    timezoneId: "Africa/Cairo",
    locale: "ar-EG",
    trace: "retain-on-failure",
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
