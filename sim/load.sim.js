/*
  حمل بيانات وتحمّل اتصالات على قاعدة حقيقية:
  (أ) حجم بيانات سنين (٢٠ ألف حجز + ٣ سنين يوميات + استهلاك استاف): بنقيس زمن الاستعلامات اللي الواجهة بتعملها
      (بصلاحية مستخدم حقيقي تحت RLS) وزمن إضافة حجز ورد الفلوس، ونتأكد إنها في حدود معقولة.
  (ب) ٤٠ اتصال متزامن بيعملوا عمليات مالية مختلطة لعدة ثواني: مفيش deadlock ولا أخطاء غير متوقعة، وبعدها
      القواعد المحاسبية سليمة والأداء (throughput / p95) مطبوع.
*/
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { enabled, buildTemplate, dropTemplate, newDb, mulberry32 } from "./helpers.js";
import { addDays } from "../src/domain/dates.js";

const timed = async (fn) => { const t = performance.now(); const r = await fn(); return { ms: performance.now() - t, r }; };
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))] || 0; };

describe.skipIf(!enabled)("حمل وتحمّل", () => {
  beforeAll(async () => { await buildTemplate(); });
  afterAll(async () => { await dropTemplate(); });

  it("حجم بيانات ٧ سنين (٢٠ ألف حجز، ٣ سنين يوميات، ٥ آلاف استهلاك استاف): الاستعلامات والعمليات في حدود معقولة", async () => {
    const db = await newDb();
    try {
      const [{ today }] = await db.q("select hotel_today()::text today");
      const seed = await timed(async () => {
        await db.q(`insert into bookings(room, guest_name, checkin, checkout, price_night, total_room, amount_paid, currency, status, extras, payment_method)
          select 600 + r, 'G' || r || '-' || k, d0 + k * 2, d0 + k * 2 + 2, 100, 200, 200, 'USD', 'تم تسجيل الخروج', '{"laundry":0,"cafeteria":20,"tours":0,"pickup":0}'::jsonb, case when k % 3 = 0 then 'فيزا' else 'كاش' end
          from generate_series(1, 16) r, generate_series(0, 1249) k, (select hotel_today() - 2500 as d0) x`);
        await db.q(`insert into shift_claims(date, shift_key, username, name) values ($1, 'morning', 'st1', 'st1')`, [today]);
        await db.q(`insert into shift_records(date, shift_key, staff_name, staff_username, closed, rows, cafeteria_rows, booking_collections, total_collections)
          select d, s, 'x', 'x', true,
                 (select jsonb_agg(jsonb_build_object('room', 600 + r, 'bookingId', gen_random_uuid(), 'collectionAmt', 200, 'collectionMethod', case when r % 3 = 0 then 'فيزا' else 'كاش' end, 'collectionCurrency', 'USD', 'collectionDesc', 'تحصيل', 'paymentDetails', jsonb_build_object('senderName','','senderNumber', case when r % 3 = 0 then '1234' else '' end,'ref',''), 'expenseAmt','', 'notes','')) from generate_series(1,16) r),
                 (select jsonb_agg(jsonb_build_object('kind','guest','bookingId', gen_random_uuid(),'collectionAmt',20,'collectionMethod','كاش','collectionCurrency','USD')) from generate_series(1,3)),
                 (select jsonb_agg(jsonb_build_object('id', gen_random_uuid(), 'bookingId', gen_random_uuid())) from generate_series(1,16)),
                 '{"USD": 3200}'::jsonb
          from (select (hotel_today() - 1 - g)::date d from generate_series(0, 1094) g) dd, unnest(array['morning','evening','night']) s`);
        await db.q(`insert into staff_cafeteria(day, consumer_name, amount, currency, paid_amount) select hotel_today() - (g % 1000), 'S' || (g % 40), 10 + g % 30, 'EGP', case when g % 4 = 0 then 0 else 10 + g % 30 end from generate_series(1, 5000) g`);
        await db.q("analyze");
      });
      console.log(`تجهيز البيانات: ${(seed.ms / 1000).toFixed(1)}ث`);
      const [{ n: nb }] = await db.q("select count(*)::int n from bookings"); expect(nb).toBe(20000);

      // استعلامات الواجهة (بصلاحية موظف حقيقي تحت RLS)
      const asStaff = (sql, params) => db.tx("st1", (c) => c.query(sql, params)).then((r) => { if (!r.ok) throw r.err; return r.r; });
      const results = {};
      results.getBookings = await timed(() => asStaff("select * from bookings order by checkin desc"));
      results.shiftDay = await timed(() => asStaff("select * from shift_records where date = $1 and shift_key = 'morning'", [addDays(today, -5)]));
      results.reportYear = await timed(() => asStaff("select * from shift_records where date >= $1 and date <= $2 order by date", [addDays(today, -366), today]));
      results.journaledIds = await timed(() => asStaff("select booking_collections from shift_records"));
      results.staffList = await timed(() => asStaff("select * from staff_cafeteria order by created_at desc"));
      results.profiles = await timed(() => asStaff("select * from profiles"));
      for (const [k, v] of Object.entries(results)) console.log(`${k}: ${v.ms.toFixed(0)}ms (${v.r.rowCount} صف)`);
      expect(results.shiftDay.ms).toBeLessThan(200);
      expect(results.reportYear.ms).toBeLessThan(3000);
      expect(results.getBookings.ms).toBeLessThan(4000);
      expect(results.staffList.ms).toBeLessThan(1500);

      // إضافة حجز جديد (exclusion + triggers + كود تلقائي + أكواد أفراد) على ٢٠ ألف حجز
      const times = [];
      for (let i = 0; i < 25; i++) {
        const t = await timed(() => db.tx("st1", (c) => c.query("insert into bookings(room, guest_name, checkin, checkout, price_night, total_room, guest_codes, pax) values ($1, 'new', $2::date + $3::int, $2::date + $3::int + 1, 100, 100, $4::jsonb, 1) returning id", [601 + (i % 16), today, 10 + i, JSON.stringify([`C${i}`])])));
        expect(t.r.ok, t.r.err?.message).toBe(true); times.push(t.ms);
      }
      console.log(`إضافة حجز على 20k: متوسط ${(times.reduce((a, b) => a + b, 0) / times.length).toFixed(1)}ms، p95 ${pct(times, 0.95).toFixed(0)}ms`);
      expect(pct(times, 0.95)).toBeLessThan(400);

      // رد فلوس على حجز مدفوع وسط ٣٢٨٥ يومية (بيحسب رصيد الوسائل من اليومية)
      await db.q("insert into shift_records(date, shift_key, staff_name, staff_username, rows) values ($1, 'morning', 'st1', 'st1', $2::jsonb)", [today, JSON.stringify([{ room: 601, expenseDesc: "", expenseAmt: "", expenseCategory: "أخرى", expenseCurrency: "EGP", collectionDesc: "", collectionAmt: "", collectionMethod: "كاش", collectionCurrency: "EGP", paymentDetails: { senderName: "", senderNumber: "", ref: "" }, notes: "" }])]);
      const [{ id }] = await db.q("insert into bookings(room, guest_name, checkin, checkout, price_night, total_room, amount_paid, currency) values (601, 'Refund Me', $1, $2::date + 1, 100, 100, 100, 'USD') returning id", [today, today]);
      await db.q("update shift_records set rows = jsonb_set(rows, '{0}', rows->0 || jsonb_build_object('bookingId', $1::text, 'collectionAmt', 100, 'collectionMethod', 'فيزا', 'collectionCurrency', 'USD')) where date = $2 and shift_key = 'morning'", [id, today]);
      expect((await db.tx("res1", (c) => c.query("update bookings set status = 'ملغي' where id = $1", [id]))).ok).toBe(true);
      const refund = await timed(() => db.tx("res1", (c) => c.query("select decide_booking_refund($1, 'refund', null, 'فيزا') r", [id])));
      console.log(`رد فلوس وسط 3285 يومية: ${refund.ms.toFixed(0)}ms`);
      expect(refund.r.ok, refund.r.err?.message).toBe(true);
      expect(refund.ms).toBeLessThan(1500);
    } finally { await db.close(); }
  });

  it("٤٠ اتصال متزامن بيعملوا عمليات مالية مختلطة لـ ١٥ ثانية: مفيش deadlock ولا أخطاء غير متوقعة، والمحاسبة سليمة", async () => {
    const db = await newDb();
    try {
      const [{ today }] = await db.q("select hotel_today()::text today");
      await db.q("insert into shift_claims(date, shift_key, username, name) values ($1, 'morning', 'st1', 'st1')", [today]);
      const mkRow = (room) => ({ room, expenseDesc: "", expenseAmt: "", expenseCategory: "أخرى", expenseCurrency: "EGP", collectionDesc: "", collectionAmt: "", collectionMethod: "كاش", collectionCurrency: "EGP", paymentDetails: { senderName: "", senderNumber: "", ref: "" }, notes: "" });
      await db.q("insert into shift_records(date, shift_key, staff_name, staff_username, rows) values ($1, 'morning', 'st1', 'st1', $2::jsonb)", [today, JSON.stringify(Array.from({ length: 16 }, (_, i) => mkRow(601 + i)))]);
      // ١٦ حجز شغّال (واحد لكل غرفة)
      const ids = [];
      for (let i = 0; i < 16; i++) { const [{ id }] = await db.q("insert into bookings(room, guest_name, checkin, checkout, price_night, total_room, currency) values ($1, $2, $3, $3::date + 3, 100, 300, 'USD') returning id", [601 + i, `L${i}`, today]); ids.push(id); }
      const stats = { ok: 0, conflict: 0, deadlock: 0, other: 0, otherMsgs: new Set(), lat: [] };
      const stop = Date.now() + 15000;
      const worker = async (w) => {
        const rnd = mulberry32(w * 31 + 7);
        while (Date.now() < stop) {
          const id = ids[Math.floor(rnd() * ids.length)];
          const kind = rnd();
          const t0 = performance.now();
          const res = await db.tx("st1", async (c) => {
            if (kind < 0.55) {
              // تحصيل: الحجز + اليومية في نفس المعاملة (نفس الترتيب في كل مكان: الحجز ثم اليومية)
              const { rows: [b] } = await c.query("select amount_paid::float p, room from bookings where id = $1 for update", [id]);
              if (b.p >= 300) return "skip";
              const amt = 10 + Math.floor(rnd() * 40);
              await c.query("update bookings set amount_paid = amount_paid + $2, payment_method = 'فيزا' where id = $1", [id, Math.min(amt, 300 - b.p)]);
              await c.query(`update shift_records set rows = jsonb_set(rows, array[($2::int - 601)::text, 'collectionAmt'], to_jsonb(coalesce(nullif(rows -> ($2::int - 601) ->> 'collectionAmt', '')::numeric, 0) + $3::numeric)) where date = $1 and shift_key = 'morning'`, [today, b.room, Math.min(amt, 300 - b.p)]);
            } else if (kind < 0.8) {
              await c.query("insert into staff_cafeteria(consumer_name, amount, currency) values ($1, $2, 'EGP')", [`w${w}`, 10 + Math.floor(rnd() * 30)]);
            } else {
              await c.query("update bookings set extras = jsonb_set(extras, '{tours}', to_jsonb($2::int)) where id = $1", [id, Math.floor(rnd() * 20)]);
            }
          });
          stats.lat.push(performance.now() - t0);
          if (res.ok) stats.ok++;
          else if (res.err?.code === "40P01") stats.deadlock++;
          else if (res.err?.code === "40001") stats.conflict++;
          else { stats.other++; stats.otherMsgs.add(res.err?.message); }
        }
      };
      await Promise.all(Array.from({ length: 40 }, (_, w) => worker(w)));
      const tput = stats.ok / 15;
      console.log(`تحمّل: ${stats.ok} عملية ناجحة (${tput.toFixed(0)}/ث)، p50 ${pct(stats.lat, 0.5).toFixed(0)}ms، p95 ${pct(stats.lat, 0.95).toFixed(0)}ms، p99 ${pct(stats.lat, 0.99).toFixed(0)}ms، deadlocks ${stats.deadlock}، أخطاء ${stats.other} ${[...stats.otherMsgs].join(" | ")}`);
      expect(stats.deadlock).toBe(0);
      expect(stats.other, [...stats.otherMsgs].join(" | ")).toBe(0);
      expect(stats.ok).toBeGreaterThan(200);
      // المحاسبة: مجموع تحصيل اليومية (دولار) = مجموع المدفوع على الحجوزات
      const [led] = await db.q("select rows from shift_records");
      const ledger = led.rows.reduce((a, x) => a + (Number(x.collectionAmt) || 0), 0);
      const [{ paid }] = await db.q("select coalesce(sum(amount_paid), 0)::float paid from bookings");
      expect(ledger).toBe(paid);
      // الحالة التلقائية: المدفوع ≥ الإجمالي (الغرفة + الرسوم الإضافية اللي اتغيّرت أثناء الحمل)
      for (const b of await db.q("select amount_paid::float p, settled, (total_room + coalesce((extras->>'tours')::numeric, 0) + coalesce((extras->>'cafeteria')::numeric, 0))::float t from bookings")) expect(b.settled, `p=${b.p} t=${b.t}`).toBe(b.p >= b.t);
    } finally { await db.close(); }
  });
});
