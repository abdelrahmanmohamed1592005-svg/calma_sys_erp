/*
  تسابق (تزامن) حقيقي على قاعدة Postgres: كذا اتصال في نفس اللحظة بيعدّلوا نفس الحجز/اليومية/الاستهلاك/الشيفت.
  بنحاكي نفس خوارزمية الواجهة (قفل متفائل بـ updated_at + إعادة محاولة في اليومية) وبنتأكد إن مفيش فلوس
  بتضيع أو بتتكرر، ومفيش حجز مزدوج، وإن قرار الرد بيتاخد مرة واحدة بس.
*/
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { enabled, buildTemplate, dropTemplate, newDb } from "./helpers.js";
import { applyCollectionToRows } from "../src/domain/money.js";
import { addDays } from "../src/domain/dates.js";

const emptyRow = (room) => ({ room, expenseDesc: "", expenseAmt: "", expenseCategory: "أخرى", expenseCurrency: "EGP", collectionDesc: "", collectionAmt: "", collectionMethod: "كاش", collectionCurrency: "EGP", paymentDetails: { senderName: "", senderNumber: "", ref: "", onlinePaid: false }, notes: "" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function setup() {
  const db = await newDb();
  const [{ today }] = await db.q("select hotel_today()::text today");
  await db.q("insert into shift_claims(date, shift_key, username, name) values ($1, 'morning', 'st1', 'st1')", [today]);
  await db.q("insert into shift_records(date, shift_key, staff_name, staff_username, rows) values ($1, 'morning', 'st1', 'st1', $2::jsonb)", [today, JSON.stringify([601, 602, 603].map(emptyRow))]);
  return { db, today };
}

describe.skipIf(!enabled)("تزامن حقيقي", () => {
  beforeAll(async () => { await buildTemplate(); });
  afterAll(async () => { await dropTemplate(); });

  it("٨ موظفين بيحصّلوا على نفس الحجز في نفس اللحظة: مفيش فلوس بتضيع أو بتتكرر (اليومية = المدفوع)", async () => {
    const { db, today } = await setup();
    try {
      const [{ id }] = await db.q("insert into bookings(room, guest_name, checkin, checkout, price_night, total_room, currency) values (601, 'Race', $1, $2, 100, 400, 'USD') returning id", [today, addDays(today, 4)]);
      let conflicts = 0, ledgerFailures = 0, wins = 0;
      const payer = async (n) => {
        for (let round = 0; round < 6; round++) {
          const [b] = await db.q("select amount_paid::float paid, updated_at from bookings where id = $1", [id]);
          if (b.paid >= 400) return;
          await sleep(Math.random() * 15);
          // ١) تحديث الحجز بقفل متفائل (زي updateBookingIfUnchanged)
          const res = await db.tx("st1", (c) => c.query("update bookings set amount_paid = amount_paid + 25, payment_method = 'فيزا' where id = $1 and updated_at = $2 returning id", [id, b.updated_at]));
          if (!res.ok) throw res.err;
          if (res.r.rowCount === 0) { conflicts++; continue; }
          wins++;
          // ٢) تسجيل في اليومية بإعادة محاولة عند التعارض (زي appendBookingCollection)
          let ok = false;
          for (let attempt = 0; attempt < 40 && !ok; attempt++) {
            const [rec] = await db.q("select rows, booking_collections, updated_at from shift_records");
            const rows = applyCollectionToRows(rec.rows, { id: `${n}-${round}`, bookingId: id, room: 601, guestName: "Race", amount: 25, currency: "USD", method: "فيزا", details: { senderNumber: String(1000 + n) }, note: "تحصيل" }).rows;
            const r2 = await db.tx("st1", (c) => c.query("update shift_records set rows = $1::jsonb, booking_collections = $2::jsonb where updated_at = $3 returning 1", [JSON.stringify(rows), JSON.stringify([...rec.booking_collections, { id: `${n}-${round}`, bookingId: id }]), rec.updated_at]));
            if (r2.ok && r2.r.rowCount === 1) ok = true; else await sleep(Math.random() * 10);
          }
          if (!ok) ledgerFailures++;
        }
      };
      await Promise.all(Array.from({ length: 8 }, (_, n) => payer(n)));
      const [b] = await db.q("select amount_paid::float paid, settled from bookings where id = $1", [id]);
      const [rec] = await db.q("select rows from shift_records");
      const ledger = rec.rows.reduce((a, x) => a + (Number(x.collectionAmt) || 0), 0);
      expect(ledgerFailures).toBe(0);
      expect(b.paid).toBe(wins * 25);                 // كل تحصيل ناجح اتحسب مرة واحدة بالظبط
      expect(ledger).toBe(b.paid);                    // واليومية بتطابق
      expect(b.paid).toBeLessThanOrEqual(400 + 25 * 7);
      expect(conflicts).toBeGreaterThan(0);           // التسابق حصل فعلاً
    } finally { await db.close(); }
  });

  it("حجزين على نفس الغرفة والتواريخ في نفس اللحظة: واحد بس ينجح (مفيش حجز مزدوج)", async () => {
    const { db, today } = await setup();
    try {
      const attempt = (u) => db.tx(u, (c) => c.query("insert into bookings(room, guest_name, checkin, checkout, price_night, total_room) values (602, $1, $2, $3, 100, 200)", [u, addDays(today, 1), addDays(today, 3)]));
      const results = await Promise.all(["st1", "res1", "st1", "res1", "st1", "res1"].map((u, i) => attempt(u)));
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      results.filter((r) => !r.ok).forEach((r) => expect(String(r.err.code) + r.err.message).toMatch(/23P01|bookings_no_overlap|exclusion/));
      expect(await db.q("select 1 from bookings where room = 602")).toHaveLength(1);
    } finally { await db.close(); }
  });

  it("قرارين رد فلوس على نفس الحجز في نفس اللحظة: الرد بيتنفّذ مرة واحدة بس", async () => {
    const { db, today } = await setup();
    try {
      const [{ id }] = await db.q("insert into bookings(room, guest_name, checkin, checkout, price_night, total_room, amount_paid, currency) values (603, 'Refund Race', $1, $2, 100, 100, 100, 'USD') returning id", [today, addDays(today, 1)]);
      await db.q("update shift_records set rows = jsonb_set(rows, '{2}', rows->2 || '{\"bookingId\":\"" + id + "\",\"collectionAmt\":100,\"collectionMethod\":\"فيزا\",\"collectionCurrency\":\"USD\",\"paymentDetails\":{\"senderName\":\"\",\"senderNumber\":\"7777\",\"ref\":\"\",\"onlinePaid\":false}}'::jsonb)");
      const c = await db.tx("res1", (x) => x.query("update bookings set status = 'ملغي' where id = $1", [id])); expect(c.ok).toBe(true);
      const results = await Promise.all(Array.from({ length: 5 }, () => db.tx("res1", (x) => x.query("select decide_booking_refund($1, 'refund', null, 'فيزا') r", [id]))));
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      const [b] = await db.q("select amount_paid::float paid, refunded_amount::float ra from bookings where id = $1", [id]);
      expect(b).toEqual({ paid: 0, ra: 100 });
      const [rec] = await db.q("select rows from shift_records");
      expect(rec.rows.reduce((a, x) => a + (Number(x.collectionAmt) || 0), 0)).toBe(0);
    } finally { await db.close(); }
  });

  it("سداد متزامن لنفس مديونية استاف: ماينفعش المدفوع يعدّي المبلغ (قفل متفائل + قيد قاعدة البيانات)", async () => {
    const { db } = await setup();
    try {
      const [{ id }] = await db.q("insert into staff_cafeteria(consumer_name, amount, currency) values ('سارة', 100, 'EGP') returning id");
      const payer = async () => {
        for (let i = 0; i < 8; i++) {
          const [e] = await db.q("select paid_amount::float paid, updated_at from staff_cafeteria where id = $1", [id]);
          if (e.paid >= 100) return;
          await db.tx("st1", (c) => c.query("update staff_cafeteria set paid_amount = paid_amount + 30, payments = payments || '[{\"amount\":30}]'::jsonb where id = $1 and updated_at = $2", [id, e.updated_at]));
          await sleep(Math.random() * 10);
        }
      };
      await Promise.all(Array.from({ length: 6 }, payer));
      const [e] = await db.q("select paid_amount::float paid, jsonb_array_length(payments) n from staff_cafeteria");
      expect(e.paid).toBeLessThanOrEqual(100);
      expect(e.paid).toBe(e.n * 30);
    } finally { await db.close(); }
  });

  it("RPC: موظفين بشيفتات مختلفة بيسدّدوا نفس مديونية الاستاف وبيحصّلوا على نفس الحجز في نفس اللحظة: اليومية = المدفوع دايمًا", async () => {
    const { db, today } = await setup();
    try {
      await db.q("insert into shift_claims(date, shift_key, username, name) values ($1, 'evening', 'st2', 'st2')", [today]);
      await db.q("insert into shift_records(date, shift_key, staff_name, staff_username, rows) values ($1, 'evening', 'st2', 'st2', $2::jsonb)", [today, JSON.stringify([601].map(emptyRow))]);
      for (let d = 0; d < 12; d++) await db.q("insert into staff_cafeteria(consumer_name, amount, currency) values ($1, 100, 'EGP')", ["سارة" + d]);
      const [{ id }] = await db.q("insert into bookings(room, guest_name, checkin, checkout, price_night, total_room, currency) values (601, 'Race2', $1, $2, 100, 100, 'USD') returning id", [today, addDays(today, 1)]);
      const jobs = [];
      for (let i = 0; i < 6; i++) {
        const u = i % 2 ? "st1" : "st2";
        for (let d = 0; d < 12; d++) jobs.push(db.tx(u, (c) => c.query("select settle_staff_cafeteria($1, null, 'EGP', 60, 'كاش', '{}'::jsonb) r", ["سارة" + d])));
        jobs.push(db.tx(u, (c) => c.query("select record_booking_payment($1, 60, 'كاش', '{}'::jsonb, null) r", [id])));
      }
      await Promise.all(jobs);
      const [e] = await db.q("select sum(paid_amount)::float paid, max(paid_amount)::float mx from staff_cafeteria");
      const [b] = await db.q("select amount_paid::float paid from bookings where id = $1", [id]);
      const recs = await db.q("select rows, cafeteria_rows from shift_records");
      const sum = (arr, k) => (arr || []).reduce((a, x) => a + (Number(x[k]) || 0), 0);
      expect(e.mx).toBeLessThanOrEqual(100);
      expect(b.paid).toBeLessThanOrEqual(100);
      expect(sum(recs.flatMap((r) => r.cafeteria_rows), "collectionAmt")).toBeCloseTo(e.paid, 2);
      expect(sum(recs.flatMap((r) => r.rows), "collectionAmt")).toBeCloseTo(b.paid, 2);
    } finally { await db.close(); }
  });

  it("موظفين بيختاروا نفس الشيفت في نفس اللحظة: واحد بس ياخده", async () => {
    const { db, today } = await setup();
    try {
      await db.q("delete from shift_records"); await db.q("delete from shift_claims");
      const claim = (u) => db.tx(u, (c) => c.query("insert into shift_claims(date, shift_key, username, name) values ($1, 'evening', $2, $2)", [today, u]));
      const rs = await Promise.all(["st1", "st2", "st1", "st2"].map(claim));
      expect(rs.filter((r) => r.ok)).toHaveLength(1);
      expect(await db.q("select 1 from shift_claims")).toHaveLength(1);
    } finally { await db.close(); }
  });
});
