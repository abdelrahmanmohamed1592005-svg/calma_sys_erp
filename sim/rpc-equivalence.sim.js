/*
  اختبار تكافؤ (differential): نفس تسلسل الدفعات عشوائيًا بيتنفّذ مرتين - مرة بكود الواجهة (src/domain/money.js:
  applyCollectionToRows / applyCafeteriaCollection / splitPaymentForCafeteria) ومرة بدوال قاعدة البيانات الذرية
  (record_booking_payment / record_staff_cafeteria / settle_staff_cafeteria) - وبنقارن صفوف اليومية وصفوف الكافيتيريا
  والمدفوع بعد كل خطوة. أي اختلاف = نسختين من المنطق ابتعدوا عن بعض.
*/
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { enabled, buildTemplate, dropTemplate, newDb, mulberry32 } from "./helpers.js";
import { applyCollectionToRows, applyCafeteriaCollection, splitPaymentForCafeteria, emptyLedgerRow, cleanPaymentDetailsFor, PAYMENT_METHODS, bookingHotelTotal } from "../src/domain/money.js";
import { addDays } from "../src/domain/dates.js";

const r2 = (n) => Math.round(n * 100) / 100;
const norm = (r) => ({
  room: r.room, bookingId: r.bookingId || null, kind: r.kind || null, who: r.who || null, consumerKey: r.consumerKey || null, guestRoom: r.guestRoom || null,
  amt: Number(r.collectionAmt) || 0, method: r.collectionMethod, cur: r.collectionCurrency, desc: r.collectionDesc || "",
  name: r.paymentDetails?.senderName || "", num: r.paymentDetails?.senderNumber || "",
});

describe.skipIf(!enabled)("تكافؤ منطق الواجهة مع دوال القاعدة", () => {
  beforeAll(async () => { await buildTemplate(); });
  afterAll(async () => { await dropTemplate(); });

  for (const seed of [11, 202, 3033, 40404, 505050]) {
    it(`seed ${seed}: صفوف اليومية والكافيتيريا والمدفوع متطابقة بعد كل خطوة`, async () => {
      const db = await newDb();
      const rnd = mulberry32(seed);
      const pick = (a) => a[Math.floor(rnd() * a.length)];
      try {
        const [{ today }] = await db.q("select hotel_today()::text today");
        const ROOMS = [601, 602, 603, 604];
        const init = ROOMS.map((n) => emptyLedgerRow(n));
        await db.q("insert into shift_claims(date, shift_key, username, name) values ($1, 'morning', 'st1', 'st1')", [today]);
        await db.q("insert into shift_records(date, shift_key, staff_name, staff_username, rows) values ($1, 'morning', 'st1', 'st1', $2::jsonb)", [today, JSON.stringify(init)]);
        let rows = init, caf = [];
        const bookings = [];
        for (let i = 0; i < ROOMS.length; i++) {
          const cafe = pick([0, 25, 60]), total = pick([200, 300, 450]);
          const [{ id }] = await db.q("insert into bookings(room, guest_name, checkin, checkout, price_night, total_room, currency, extras) values ($1, $2, $3, $4, 100, $5, $6, $7::jsonb) returning id", [ROOMS[i], pick(["أحمد", "Mona", "نزيل 'خاص'", ""]), today, addDays(today, 3), total, pick(["USD", "EGP"]), JSON.stringify({ laundry: 0, cafeteria: cafe, tours: 0, pickup: 0 })]);
          const [b] = await db.q("select currency, extras, guest_name from bookings where id = $1", [id]);
          bookings.push({ id, room: ROOMS[i], currency: b.currency, guestName: b.guest_name, extras: b.extras, total, paid: 0 });
        }
        const staffModel = [];                                         // {name, username, cur, amount, paid}
        const dets = (method) => (method === "فيزا" ? { senderNumber: pick(["1111", "2222", "٣٣٣٣"]) } : method === "كاش" ? {} : { senderName: pick(["كريم", "منى", " سارة "]), senderNumber: pick(["01011112222", "٠١٠٩٩٩٩٨٨٨٨"]) });
        const compare = async (label) => {
          const [rec] = await db.q("select rows, cafeteria_rows from shift_records");
          expect(rec.rows.map(norm), `${label}: صفوف الغرف`).toEqual(rows.map(norm));
          expect(rec.cafeteria_rows.map(norm), `${label}: صفوف الكافيتيريا`).toEqual(caf.map(norm));
          for (const b of bookings) {
            const [x] = await db.q("select amount_paid::float p, extras from bookings where id = $1", [b.id]);
            expect(x.p, `${label}: مدفوع ${b.id}`).toBeCloseTo(b.paid, 6);
            expect(Number(x.extras.cafeteriaPaid || 0), `${label}: cafeteriaPaid`).toBeCloseTo(Number(b.extras.cafeteriaPaid || 0), 6);
          }
          const st = await db.q("select consumer_name, paid_amount::float p, amount::float a from staff_cafeteria order by created_at, id");
          expect(st.map((s) => [s.consumer_name, s.a, s.p]), `${label}: استهلاك الاستاف`).toEqual(staffModel.map((s) => [s.name, s.amount, s.paid]));
        };
        for (let step = 0; step < 90; step++) {
          const t = rnd();
          if (t < 0.55) {
            const b = pick(bookings), due = r2(b.total + Number(b.extras.cafeteria || 0) - b.paid);
            if (due <= 0.005) continue;
            const amount = rnd() < 0.35 ? due : Math.max(0.01, r2(due * (0.1 + rnd() * 0.8)));
            const method = pick(PAYMENT_METHODS), d = dets(method), note = pick(["تحصيل", "رسم دخول مبكر", "تحصيل حجز جديد"]);
            const res = await db.tx("st1", (c) => c.query("select record_booking_payment($1, $2, $3, $4::jsonb, null, $5) r", [b.id, amount, method, JSON.stringify(d), note]));
            expect(res.ok, res.err?.message).toBe(true);
            // نفس العملية بكود الواجهة
            const clean = cleanPaymentDetailsFor(method, d);
            const split = splitPaymentForCafeteria(b, amount);
            rows = applyCollectionToRows(rows, { id: "x", bookingId: b.id, room: b.room, guestName: b.guestName, amount: split.rest, currency: b.currency, method, details: clean, note }).rows;
            if (split.cafeteria > 0) { caf = applyCafeteriaCollection(caf, { kind: "guest", bookingId: b.id, room: b.room, who: b.guestName, amount: split.cafeteria, currency: b.currency, method, details: clean, note: "خدمة كافيتيريا" }).rows; b.extras = { ...b.extras, cafeteriaPaid: Number(b.extras.cafeteriaPaid || 0) + split.cafeteria }; }
            b.paid = r2(b.paid + amount);
          } else if (t < 0.8) {
            const name = pick(["سارة", "منى", "حسن"]), amount = pick([10, 25, 40.5]), cur = pick(["EGP", "USD"]), payNow = rnd() < 0.4, method = pick(PAYMENT_METHODS), d = dets(method);
            const res = await db.tx("st1", (c) => c.query("select record_staff_cafeteria($1, null, 'x', $2, $3, $4, $5::jsonb) r", [name, amount, cur, payNow ? method : null, JSON.stringify(d)]));
            expect(res.ok, res.err?.message).toBe(true);
            staffModel.push({ name, cur, amount, paid: payNow ? amount : 0 });
            if (payNow) caf = applyCafeteriaCollection(caf, { kind: "staff", consumerKey: name.toLowerCase(), who: name, amount, currency: cur, method, details: cleanPaymentDetailsFor(method, d), note: "كافيتيريا استاف" }).rows;
          } else {
            const open = staffModel.filter((s) => s.paid < s.amount);
            if (!open.length) continue;
            const who = pick(open), group = staffModel.filter((s) => s.name === who.name && s.cur === who.cur && s.paid < s.amount), owed = r2(group.reduce((a, s) => a + s.amount - s.paid, 0));
            const amount = rnd() < 0.5 ? owed : Math.max(0.01, r2(owed * (0.2 + rnd() * 0.6))), method = pick(PAYMENT_METHODS), d = dets(method);
            const res = await db.tx("st1", (c) => c.query("select settle_staff_cafeteria($1, null, $2, $3, $4, $5::jsonb) r", [who.name, who.cur, amount, method, JSON.stringify(d)]));
            expect(res.ok, res.err?.message).toBe(true);
            let left = amount;
            for (const s of group) { if (left <= 0) break; const part = Math.min(left, s.amount - s.paid); s.paid = r2(s.paid + part); left = r2(left - part); }
            caf = applyCafeteriaCollection(caf, { kind: "staff", consumerKey: who.name.toLowerCase(), who: who.name, amount, currency: who.cur, method, details: cleanPaymentDetailsFor(method, d), note: "كافيتيريا استاف" }).rows;
          }
          await compare(`خطوة ${step + 1}`);
        }
      } finally { await db.close(); }
    });
  }

  it("التحقق بيتنفّذ في القاعدة نفسها: مبلغ أكبر من المتبقي، حجز ملغي، وسيلة/تفاصيل غلط، غير موظف، من غير شيفت، قفل متفائل", async () => {
    const db = await newDb();
    try {
      const [{ today }] = await db.q("select hotel_today()::text today");
      const [{ id }] = await db.q("insert into bookings(room, guest_name, checkin, checkout, price_night, total_room) values (601, 'V', $1, $2, 100, 100) returning id", [today, addDays(today, 1)]);
      const pay = (u, amount, method = "كاش", details = {}, expected = null) => db.tx(u, (c) => c.query("select record_booking_payment($1, $2, $3, $4::jsonb, $5) r", [id, amount, method, JSON.stringify(details), expected]));
      expect((await pay("st1", 10)).err?.message).toContain("مفيش شيفتك مفتوح");                 // من غير شيفت
      await db.q("insert into shift_claims(date, shift_key, username, name) values ($1, 'morning', 'st1', 'st1')", [today]);
      await db.q("insert into shift_records(date, shift_key, staff_name, staff_username, rows) values ($1, 'morning', 'st1', 'st1', $2::jsonb)", [today, JSON.stringify([emptyLedgerRow(601)])]);
      expect((await pay("res1", 10)).err?.message).toContain("موظف الشيفت");                      // مدير الحجوزات مايحصّلش
      expect((await pay("acc1", 10)).err?.message).toContain("موظف الشيفت");
      expect((await pay("st2", 10)).err?.message).toContain("مفيش شيفتك مفتوح");                  // موظف تاني من غير شيفت
      expect((await pay("st1", 0)).ok).toBe(false); expect((await pay("st1", -5)).ok).toBe(false);
      expect((await pay("st1", 101)).err?.message).toContain("أكبر من المتبقي");
      expect((await pay("st1", 10, "عملة")).err?.message).toContain("وسيلة الدفع");
      expect((await pay("st1", 10, "فيزا", { senderNumber: "12" })).err?.message).toContain("آخر ٤ أرقام");
      expect((await pay("st1", 10, "فودافون كاش", { senderName: "x" })).err?.message).toContain("رقم التليفون");
      expect((await pay("st1", 10, "كاش", {}, "2000-01-01T00:00:00Z")).err?.message).toContain("اتغيّر من حد تاني");
      expect((await db.q("select amount_paid::float p from bookings"))[0].p).toBe(0);              // ولا حاجة اتسجّلت من الرفضات
      expect((await db.q("select rows from shift_records"))[0].rows.some((r) => Number(r.collectionAmt) !== 0)).toBe(false);
      expect((await pay("st1", 40, "فيزا", { senderNumber: "٤٢٤٢" })).ok).toBe(true);
      const rows = (await db.q("select rows from shift_records"))[0].rows;
      expect(rows[0]).toMatchObject({ collectionAmt: 40, collectionMethod: "فيزا", bookingId: id }); expect(rows[0].paymentDetails.senderNumber).toBe("4242");
      await db.tx("res1", (c) => c.query("update bookings set status = 'ملغي' where id = $1", [id]));
      expect((await pay("st1", 10)).err?.message).toContain("ملغي");
      const sc = (u, ...a) => db.tx(u, (c) => c.query("select settle_staff_cafeteria($1, null, 'EGP', $2, 'كاش', '{}'::jsonb) r", a));
      expect((await sc("st1", "مجهول", 5)).err?.message).toContain("مفيش مديونية");
      await db.tx("st1", (c) => c.query("select record_staff_cafeteria('سارة', null, '', 50, 'EGP')"));
      expect((await sc("st1", "سارة", 80)).err?.message).toContain("أكبر من المديونية");
      expect((await sc("res1", "سارة", 10)).err?.message).toContain("موظف الشيفت");
      expect((await db.tx("st1", (c) => c.query("select record_staff_cafeteria('  ', null, '', 5, 'EGP')"))).ok).toBe(false);
      expect((await db.tx("st1", (c) => c.query("select record_staff_cafeteria('x', null, '', 5, 'XYZ')"))).ok).toBe(false);
      expect((await db.tx("st1", (c) => c.query("select record_staff_cafeteria('x', null, '', 5, 'EGP', 'فيزا', '{}'::jsonb)"))).err?.message).toContain("آخر ٤ أرقام");
    } finally { await db.close(); }
  });
});
