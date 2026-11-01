/* الفنادق المتعددة - محاكاة عشوائية على Postgres حقيقي: ٤ موظفين في ٤ فنادق بنفس الشيفت ونفس اليوم، عمليات تحصيل عشوائية
   على حجوزات من كل الفنادق (الصح والغلط). القواعد اللي لازم تتحقق بعد كل العمليات:
   - تحصيل حجز فندق تاني مرفوض دايمًا ومابيغيّرش حاجة.
   - يومية كل فندق فيها تحصيل حجوزات فندقه بس، ومجموعها = مجموع المدفوع على حجوزات الفندق ده.
   - كافيتيريا الاستاف ومديونيتها لكل فندق لوحدها. */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { enabled, buildTemplate, dropTemplate, newDb, mulberry32 } from "./helpers.js";

const SEEDS = Number(process.env.SIM_SEEDS || 6), OPS = Number(process.env.SIM_OPS || 120);
const HOTEL_ROOMS = { 1: [601, 602, 603, 604], 2: [201, 202, 203, 204], 3: [401, 402, 403, 404], 4: [301, 302, 303, 304] };

describe.skipIf(!enabled)("فنادق متعددة: عزل التحصيل واليوميات", () => {
  beforeAll(async () => { await buildTemplate(); });
  afterAll(async () => { await dropTemplate(); });

  for (let seed = 1; seed <= SEEDS; seed++) {
    it(`seed ${seed}: ${OPS} عملية عشوائية عبر ٤ فنادق`, async () => {
      const rnd = mulberry32(seed * 7919);
      const db = await newDb();
      try {
        const staff = { 1: "st1", 2: "st2", 3: "st3", 4: "st4" };
        for (const u of ["st3", "st4"]) {
          const id = randomUUID(); db.ids[u] = id;
          await db.pool.query("insert into auth.users(id, email) values ($1, $2)", [id, `${u}@calma.internal`]);
          await db.pool.query("insert into profiles(id, username, name, role) values ($1, $2, $2, 'staff')", [id, u]);
        }
        const [{ today }] = await db.q("select hotel_today()::text today");
        for (const [h, u] of Object.entries(staff)) {
          await db.q("insert into shift_claims(hotel_id, date, shift_key, username, name) values ($1, $2, 'morning', $3, $3)", [h, today, u]);
          await db.q("insert into shift_records(hotel_id, date, shift_key, staff_name, staff_username) values ($1, $2, 'morning', $3, $3)", [h, today, u]);
        }
        // حجوزات في كل فندق (إجمالي ٥٠٠ لكل حجز بالجنيه)
        const bookings = [];
        for (const [h, rooms] of Object.entries(HOTEL_ROOMS)) for (const r of rooms) {
          const [{ id }] = await db.q("insert into bookings(room, guest_name, checkin, checkout, price_night, total_room, currency) values ($1,$2,$3::date - 1,$3::date + 4,100,500,'EGP') returning id", [r, `g${r}`, today]);
          bookings.push({ id, hotel: Number(h), room: r });
        }
        expect((await db.q("select count(*)::int n from bookings where hotel_id = 2"))[0].n).toBe(4);

        const expectPaid = new Map(bookings.map((b) => [b.id, 0]));
        let accepted = 0, rejectedForeign = 0;
        for (let i = 0; i < OPS; i++) {
          const b = bookings[Math.floor(rnd() * bookings.length)];
          const hotel = 1 + Math.floor(rnd() * 4);                       // موظف أي فندق بيحاول
          const amt = 1 + Math.floor(rnd() * 90);
          const r = await db.tx(staff[hotel], (c) => c.query("select record_booking_payment($1, $2, 'كاش', '{}'::jsonb, null, null)", [b.id, amt]));
          if (hotel === b.hotel) {
            const left = 500 - expectPaid.get(b.id);
            if (amt <= left) { expect(r.ok, r.err?.message).toBe(true); expectPaid.set(b.id, expectPaid.get(b.id) + amt); accepted++; }
            else expect(r.ok).toBe(false);                                // أكبر من المتبقي
          } else {
            expect(r.ok, `hotel ${hotel} على حجز فندق ${b.hotel} لازم يترفض`).toBe(false);
            expect(r.err.message).toContain("فندق تاني");
            rejectedForeign++;
          }
        }
        expect(accepted).toBeGreaterThan(0);
        expect(rejectedForeign).toBeGreaterThan(0);

        // مدفوع كل حجز = المتوقع، ومجموع يومية كل فندق = مدفوع حجوزات الفندق ده بالظبط
        for (const b of bookings) expect(Number((await db.q("select amount_paid a from bookings where id = $1", [b.id]))[0].a)).toBe(expectPaid.get(b.id));
        for (const h of [1, 2, 3, 4]) {
          const [rec] = await db.q("select rows from shift_records where hotel_id = $1 and date = $2 and shift_key = 'morning'", [h, today]);
          const sum = rec.rows.reduce((s, x) => s + (Number(x.collectionAmt) || 0), 0);
          const want = bookings.filter((b) => b.hotel === h).reduce((s, b) => s + expectPaid.get(b.id), 0);
          expect(sum, `يومية فندق ${h}`).toBe(want);
          const rooms = new Set(rec.rows.filter((x) => Number(x.collectionAmt)).map((x) => x.room));
          for (const room of rooms) expect(HOTEL_ROOMS[h]).toContain(room);
        }

        // كافيتيريا الاستاف: مديونية كل فندق لوحدها، والسداد بيخصم من فندق الموظف بس
        for (const h of [1, 2]) {
          const rr = await db.tx(staff[h], (c) => c.query("select record_staff_cafeteria('عامل', null, 'قهوة', 100, 'EGP')"));
          expect(rr.ok, rr.err?.message).toBe(true);
        }
        const debts = await db.q("select hotel_id, sum(amount - paid_amount)::int d from staff_cafeteria group by hotel_id order by hotel_id");
        expect(debts.map((d) => [d.hotel_id, d.d])).toEqual([[1, 100], [2, 100]]);
        const s3 = await db.tx(staff[3], (c) => c.query("select settle_staff_cafeteria('عامل', null, 'EGP', 50, 'كاش')"));
        expect(s3.ok).toBe(false);                                         // مفيش مديونية في فندق ٣
        const s2 = await db.tx(staff[2], (c) => c.query("select settle_staff_cafeteria('عامل', null, 'EGP', 40, 'كاش')"));
        expect(s2.ok, s2.err?.message).toBe(true);
        const after = await db.q("select hotel_id, sum(amount - paid_amount)::int d from staff_cafeteria group by hotel_id order by hotel_id");
        expect(after.map((d) => [d.hotel_id, d.d])).toEqual([[1, 100], [2, 60]]);
      } finally { await db.close(); }
    });
  }

  it("إضافة فنادق من أكتر من مدير في نفس اللحظة: كلها بتنجح بأرقام مختلفة، ونفس الاسم/البادئة بيترفض مرة واحدة بس", async () => {
    const db = await newDb();
    try {
      const ids = ["gm1", "gm2", "gm3"];
      for (const u of ["gm2", "gm3"]) {
        const id = randomUUID(); db.ids[u] = id;
        await db.pool.query("insert into auth.users(id, email) values ($1, $2)", [id, `${u}@calma.internal`]);
        await db.pool.query("insert into profiles(id, username, name, role) values ($1, $2, $2, 'gm')", [id, u]);
      }
      const calls = ["A", "B", "C", "D", "E", "F"].map((x, i) => db.tx(ids[i % 3], (c) => c.query("select create_hotel($1, $1, $2) id", [`Hotel ${x}`, x + x])));
      const res = await Promise.all(calls);
      expect(res.every((r) => r.ok), JSON.stringify(res.map((r) => r.err?.message))).toBe(true);
      const got = res.map((r) => r.r.rows[0].id).sort((a, b) => a - b);
      expect(got).toEqual([5, 6, 7, 8, 9, 10]);
      // نفس الاسم من اتنين في نفس اللحظة: واحد ينجح والتاني يتقفل برسالة واضحة (مش خطأ تقني)
      const dup = await Promise.all([0, 1].map((i) => db.tx(ids[i], (c) => c.query("select create_hotel('Same Name', 'S', $1) id", [i ? "Y" : "Z"]))));
      expect(dup.filter((r) => r.ok)).toHaveLength(1);
      expect(dup.find((r) => !r.ok).err.message).toContain("بنفس الاسم");
    } finally { await db.close(); }
  });
});
