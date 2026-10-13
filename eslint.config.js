import js from "@eslint/js";
import react from "eslint-plugin-react";
import hooks from "eslint-plugin-react-hooks";
import globals from "globals";

/* الهدف الأساسي: يلقط أخطاء زي `booking is not defined` (no-undef) و hooks غلط قبل ما توصل للمستخدم. */
export default [
  { ignores: ["dist/**", "node_modules/**", "evidence-out/**", "test-results/**", "playwright-report/**", "video-out/**", "supabase/functions/**"] },
  js.configs.recommended,
  {
    files: ["src/**/*.{js,jsx}"],
    plugins: { react, "react-hooks": hooks },
    languageOptions: { ecmaVersion: "latest", sourceType: "module", globals: { ...globals.browser }, parserOptions: { ecmaFeatures: { jsx: true } } },
    settings: { react: { version: "18" } },
    rules: {
      ...hooks.configs.recommended.rules,
      "react/jsx-uses-vars": "error",
      "react/jsx-uses-react": "off",
      "react/jsx-no-undef": "error",
      "no-undef": "error",
      "no-control-regex": "off",          // تنظيف مدخلات (إزالة رموز التحكم) مقصود
      "no-unused-vars": ["warn", { args: "none", ignoreRestSiblings: true, varsIgnorePattern: "^_" }],
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
  {
    files: ["src/__tests__/**/*.js", "e2e/**/*.js", "e2e-video/**/*.js", "sim/**/*.js", "scripts/**/*.{js,mjs}", "*.config.js", "supabase/tests/**"],
    languageOptions: { ecmaVersion: "latest", sourceType: "module", globals: { ...globals.node, ...globals.browser } },
    rules: { "no-unused-vars": "off", "no-control-regex": "off", "no-empty": ["error", { allowEmptyCatch: true }] },
  },
];
