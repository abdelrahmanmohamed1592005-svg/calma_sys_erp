import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { REQUIRED_SCHEMA_VERSION } from "../data/schemaCheck.js";

/* الرقم اللي الواجهة بتطلبه لازم يطابق اللي في آخر schema.sql، وإلا قاعدة قديمة تعدّي من غير بانر (حصل مع money_audit). */
describe("نسخة المخطط", () => {
  const sql = fs.readFileSync(new URL("../../supabase/schema.sql", import.meta.url), "utf8");
  it("REQUIRED_SCHEMA_VERSION = الرقم في calma_schema_version() الأخيرة في schema.sql", () => {
    const all = [...sql.matchAll(/function calma_schema_version\(\)[^$]*\$\$\s*select\s+(\d+)\s*\$\$/g)];
    expect(all.length).toBeGreaterThan(0);
    expect(Number(all[all.length - 1][1])).toBe(REQUIRED_SCHEMA_VERSION);
  });
  it("الرقم بيتعمل بعد أقسام التدقيق (آخر شيء في الملف)", () => {
    expect(sql.lastIndexOf("create table if not exists money_audit")).toBeLessThan(sql.lastIndexOf("function calma_schema_version()"));
  });
});
