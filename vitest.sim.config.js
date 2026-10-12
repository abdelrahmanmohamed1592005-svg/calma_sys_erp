import { defineConfig } from "vitest/config";

/* محاكي عشوائي كبير على قاعدة Postgres حقيقية (مش جزء من npm test العادي لأنه أبطأ):
     E2E_PG_ADMIN_URL=postgresql://user:pass@localhost:5432/postgres npm run test:sim
   SIM_SEEDS (افتراضي ٦) × SIM_OPS (افتراضي ١٢٠) عمليات عشوائية، وبعد كل عملية بنفحص قواعد المحاسبة. */
export default defineConfig({
  test: { include: ["sim/**/*.sim.js"], testTimeout: 1_800_000, hookTimeout: 300_000, pool: "forks", fileParallelism: false },
});
