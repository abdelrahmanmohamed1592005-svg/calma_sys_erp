import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/* Supabase بيفعّل pg_safeupdate: أي DELETE/UPDATE من غير WHERE بيتقفل بـ "DELETE requires a WHERE clause"
   (حتى جوه دوال plpgsql). Postgres العادي في الاختبارات مبيقفلش، فبنفحص schema.sql ستاتيكيًا. */
const sql = readFileSync(new URL("../../supabase/schema.sql", import.meta.url), "utf8").replace(/--[^\n]*/g, "");

describe("schema.sql متوافق مع pg_safeupdate", () => {
  it("مفيش DELETE/UPDATE من غير WHERE", () => {
    const offenders = [];
    const re = /\b(delete\s+from|update)\s+(?!only\b)([a-z_.]+)([\s\S]*?);/gi;
    let m;
    while ((m = re.exec(sql))) {
      const kw = m[1].toLowerCase().startsWith("delete") ? "delete" : "update";
      if (kw === "update" && !/\bset\b/i.test(m[3])) continue;
      if (!/\bwhere\b/i.test(m[3])) offenders.push(`${kw} ${m[2]} (سطر ${sql.slice(0, m.index).split("\n").length})`);
    }
    expect(offenders).toEqual([]);
  });
});
