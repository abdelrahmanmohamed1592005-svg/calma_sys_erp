/*
  تجهيز قاعدة "قالب" (template) مرة واحدة قبل اختبارات التكامل: schema.sql الحقيقي
  فوق محاكاة بسيطة لـ Supabase. كل اختبار بعدها بينسخ القالب لقاعدة خاصة بيه
  (CREATE DATABASE ... TEMPLATE) فبيشتغل على بيانات نضيفة ومعزولة.
  محتاج E2E_PG_ADMIN_URL (مستخدم Postgres يقدر ينشئ قواعد بيانات)، وبدونه اختبارات
  التكامل بتتخطى نفسها.
*/
import pg from "pg";
import { readFileSync } from "node:fs";

export const TEMPLATE = "calma_e2e_template";
export const urlFor = (admin, db) => admin.replace(/\/[^/?]*(\?|$)/, `/${db}$1`);

export default async function globalSetup() {
  const admin = process.env.E2E_PG_ADMIN_URL;
  if (!admin) return;
  const a = new pg.Client({ connectionString: admin });
  await a.connect();
  await a.query(`drop database if exists ${TEMPLATE} with (force)`);
  await a.query(`create database ${TEMPLATE}`);
  await a.end();
  const c = new pg.Client({ connectionString: urlFor(admin, TEMPLATE) });
  await c.connect();
  await c.query("set client_min_messages = warning");
  await c.query(readFileSync(new URL("../supabase/tests/stub_supabase.sql", import.meta.url), "utf8"));
  await c.query("alter table auth.users add column if not exists password text");
  await c.query(readFileSync(new URL("../supabase/schema.sql", import.meta.url), "utf8"));
  await c.end();
}
