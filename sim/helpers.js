import pg from "pg";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const ADMIN = process.env.E2E_PG_ADMIN_URL;
export const enabled = !!ADMIN;
const urlFor = (db) => ADMIN.replace(/\/[^/?]*(\?|$)/, `/${db}$1`);
const TEMPLATE = `calma_sim_template_${process.pid}`;

export async function buildTemplate() {
  const a = new pg.Client({ connectionString: ADMIN }); await a.connect();
  await a.query(`drop database if exists ${TEMPLATE} with (force)`);
  await a.query(`create database ${TEMPLATE}`); await a.end();
  const c = new pg.Client({ connectionString: urlFor(TEMPLATE) }); await c.connect();
  await c.query("set client_min_messages = warning");
  await c.query(readFileSync(new URL("../supabase/tests/stub_supabase.sql", import.meta.url), "utf8"));
  await c.query(readFileSync(new URL("../supabase/schema.sql", import.meta.url), "utf8"));
  await c.end();
}
export async function dropTemplate() {
  const a = new pg.Client({ connectionString: ADMIN }); await a.connect();
  await a.query(`drop database if exists ${TEMPLATE} with (force)`); await a.end();
}

/* قاعدة جديدة (نسخة من القالب) + مستخدمين بكل الأدوار. بترجّع أدوات: tx(user, fn) بتنفّذ بهوية مستخدم حقيقي
   تحت RLS والـ triggers، و q(sql) كمشرف للفحص. */
export async function newDb() {
  const name = `calma_sim_${process.pid}_${randomUUID().slice(0, 8).replace(/-/g, "")}`;
  const a = new pg.Client({ connectionString: ADMIN }); await a.connect();
  await a.query(`create database ${name} template ${TEMPLATE}`); await a.end();
  const pool = new pg.Pool({ connectionString: urlFor(name), max: 8, options: "-c timezone=UTC" });
  pool.on("error", () => {});
  const q = (sql, params) => pool.query(sql, params).then((r) => r.rows);
  const ids = {};
  const mk = async (u, role) => {
    const id = randomUUID(); ids[u] = id;
    await pool.query("insert into auth.users(id, email) values ($1, $2)", [id, `${u}@calma.internal`]);
    await pool.query("insert into profiles(id, username, name, role) values ($1, $2, $3, $4)", [id, u, u, role]);
  };
  await mk("gm1", "gm"); await mk("res1", "reservations"); await mk("st1", "staff"); await mk("st2", "staff"); await mk("acc1", "accounts");
  const tx = async (user, fn) => {
    const c = await pool.connect();
    try {
      await c.query("begin");
      await c.query("select set_config('request.jwt.claim.sub', $1, true)", [ids[user]]);
      await c.query("set local role authenticated");
      const r = await fn(c);
      await c.query("commit");
      return { ok: true, r };
    } catch (e) { await c.query("rollback").catch(() => {}); return { ok: false, err: e }; }
    finally { c.release(); }
  };
  const close = async () => {
    await pool.end().catch(() => {});
    const x = new pg.Client({ connectionString: ADMIN }); await x.connect();
    await x.query(`drop database if exists ${name} with (force)`); await x.end();
  };
  return { pool, q, tx, ids, close, name };
}

export const mulberry32 = (a) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
