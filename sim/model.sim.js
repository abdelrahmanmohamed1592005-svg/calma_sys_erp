/*
  محاكي عشوائي كبير (model-based) على قاعدة Postgres حقيقية بصلاحيات أدوار حقيقية (RLS + triggers):
  آلاف العمليات المختلطة (حجز، دفع بكل الوسائل والكروت، كافيتيريا نزلاء/استاف، رسوم، دخول مبكر،
  تمديد، تقصير، إلغاء، رد فلوس، مغادرة مبكرة) باستخدام كود المنطق الحقيقي بتاع الواجهة (src/domain)،
  وبعد كل عملية بنفحص قواعد المحاسبة. أي كسر بيطلّع الـ seed وسجل العمليات عشان يتعاد.
*/
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { enabled, buildTemplate, dropTemplate, newDb, mulberry32 } from "./helpers.js";
import { applyCollectionToRows, applyCafeteriaCollection, splitPaymentForCafeteria, computeShiftTotals, bookingGrandTotal, bookingHotelTotal, cleanPaymentDetailsFor, describePaymentDetails, PAYMENT_METHODS } from "../src/domain/money.js";
import { earlyLeavePatch, repricedTotalRoom } from "../src/domain/bookingLogic.js";
import { addDays } from "../src/domain/dates.js";

const SEEDS = Number(process.env.SIM_SEEDS || 6);
const OPS = Number(process.env.SIM_OPS || 120);
const ROOMS = [601, 602, 603, 604, 605];
const r2 = (n) => Math.round(n * 100) / 100;
const near = (a, b, t = 0.011) => Math.abs(a - b) <= t;
const SHIFT = "morning";
const STAFF = ["st1"];
const RPC = !process.env.SIM_CLIENT;   // الافتراضي: العمليات المالية عن طريق الـ RPC الذرية؛ SIM_CLIENT=1 بيرجّع خوارزمية الواجهة القديمة (للمقارنة)

const toB = (r) => ({ id: r.id, room: r.room, guestName: r.guest_name, checkin: r.checkin, checkout: r.checkout, priceNight: r.price_night, totalRoom: r.total_room, currency: r.currency, extras: r.extras, earlyCheckin: r.early_checkin, paymentMethod: r.payment_method, paymentDetails: r.payment_details, amountPaid: r.amount_paid, status: r.status, leftEarly: r.left_early, refundPending: r.refund_pending, settled: r.settled, notes: r.notes || "", updatedAt: r.updated_at });
const COLS = "id, room, guest_name, checkin::text checkin, checkout::text checkout, price_night::float price_night, total_room::float total_room, currency, extras, early_checkin, payment_method, payment_details, amount_paid::float amount_paid, status, left_early, refund_pending, settled, notes, updated_at";

describe.skipIf(!enabled)("محاكي عشوائي على قاعدة حقيقية", () => {
  beforeAll(async () => { await buildTemplate(); });
  afterAll(async () => { await dropTemplate(); });

  for (let s = 0; s < SEEDS; s++) {
    const seed = 1000 + s * 7919;
    it(`seed ${seed}: ${OPS} عملية والقواعد سليمة بعد كل واحدة`, async () => {
      const db = await newDb();
      const rnd = mulberry32(seed);
      const pick = (a) => a[Math.floor(rnd() * a.length)];
      const log = [];
      const negOk = new Set();                 // حجوزات الرد فيها بوسيلة معاهاش رصيد (قرار المدير) - سالب مسموح فيها
      const stats = {};
      try {
        // SIM_MUTATE=settled / refund: أعطال متعمّدة في القاعدة نفسها للتأكد إن المحاكي بيكتشفها
        if (process.env.SIM_MUTATE === "settled") await db.q("alter table bookings disable trigger bookings_zz_auto_settled");
        if (process.env.SIM_MUTATE === "overlap") await db.q("alter table bookings drop constraint bookings_no_overlap");
        const [{ today }] = await db.q("select hotel_today()::text today");
        await db.q("insert into shift_claims(date, shift_key, username, name) values ($1, $2, 'st1', 'st1')", [today, SHIFT]);
        await db.q("insert into shift_records(date, shift_key, staff_name, staff_username, rows, cafeteria_rows) values ($1, $2, 'st1', 'st1', $3::jsonb, '[]'::jsonb)", [today, SHIFT, JSON.stringify(ROOMS.map((room) => ({ room, expenseDesc: "", expenseAmt: "", expenseCategory: "أخرى", expenseCurrency: "EGP", collectionDesc: "", collectionAmt: "", collectionMethod: "كاش", collectionCurrency: "EGP", paymentDetails: { senderName: "", senderNumber: "", ref: "", onlinePaid: false }, notes: "" })))]);

        const bookings = async () => (await db.q(`select ${COLS} from bookings order by created_at`)).map(toB);
        const ledgerApply = async (c, mutate) => {
          const { rows: [rec] } = await c.query("select rows, cafeteria_rows, booking_collections from shift_records where date = $1 and shift_key = $2 for update", [today, SHIFT]);
          const next = mutate({ rows: rec.rows, cafeteriaRows: rec.cafeteria_rows, bookingCollections: rec.booking_collections });
          await c.query("update shift_records set rows = $3::jsonb, cafeteria_rows = $4::jsonb, booking_collections = $5::jsonb where date = $1 and shift_key = $2", [today, SHIFT, JSON.stringify(next.rows), JSON.stringify(next.cafeteriaRows), JSON.stringify(next.bookingCollections)]);
        };
        const randomPayment = () => {
          const method = pick(PAYMENT_METHODS);
          const details = method === "فيزا" ? { senderNumber: pick(["1111", "2222", "3333"]) } : method === "كاش" ? {} : { senderName: pick(["كريم", "منى"]), senderNumber: pick(["01011112222", "01099998888"]) };
          return { method, details: cleanPaymentDetailsFor(method, details) };
        };
        const record = (op, extra = "") => { log.push(`${op}${extra ? " " + extra : ""}`); stats[op] = (stats[op] || 0) + 1; };

        const check = async (label) => {
          const bs = await bookings();
          const [led] = await db.q("select rows, cafeteria_rows, booking_collections from shift_records");
          const all = [...led.rows, ...led.cafeteria_rows];
          const sumFor = (pred) => all.filter(pred).reduce((a, x) => a + (Number(x.collectionAmt) || 0), 0);
          const staff = await db.q("select amount::float amount, paid_amount::float paid, currency, payments from staff_cafeteria");
          for (const cur of ["USD", "EGP"]) {
            const ledgerCur = sumFor((x) => (x.collectionCurrency || "EGP") === cur);
            const paid = bs.filter((b) => b.currency === cur).reduce((a, b) => a + b.amountPaid, 0) + staff.filter((e) => e.currency === cur).reduce((a, e) => a + e.paid, 0);
            expect(near(ledgerCur, paid, 0.02 * (bs.length + 1)), `${label}: اليومية (${cur}) = المدفوع: ${ledgerCur} vs ${paid}`).toBe(true);
            const t = computeShiftTotals({ rows: led.rows, cafeteria: {}, cafeteriaRows: led.cafeteria_rows, hotelRows: [], handover: { EGP: 0 }, methodHandover: {} });
            expect(near(t.totalCollections[cur] || 0, ledgerCur, 0.02 * (bs.length + 1)), `${label}: computeShiftTotals (${cur})`).toBe(true);
          }
          for (const b of bs) {
            const due = b.status === "ملغي" ? 0 : Math.max(0, bookingHotelTotal(b) - b.amountPaid);
            expect(b.amountPaid, `${label}: مدفوع سالب ${b.id}`).toBeGreaterThanOrEqual(0);
            expect(b.settled, `${label}: settled تلقائي (${b.id}) status=${b.status} paid=${b.amountPaid} due=${due}`).toBe(b.status !== "ملغي" && b.amountPaid >= bookingHotelTotal(b) - 1e-9);
            if (b.refundPending) {
              const owed = b.status === "ملغي" ? b.amountPaid : b.amountPaid - bookingGrandTotal(b);
              expect(owed, `${label}: طلب رد من غير فلوس زيادة (${b.id})`).toBeGreaterThan(0);
            }
            const mine = all.filter((x) => x.bookingId === b.id && (x.collectionCurrency || "EGP") === b.currency);
            const net = mine.reduce((a, x) => a + (Number(x.collectionAmt) || 0), 0);
            expect(near(net, b.amountPaid, 0.02 * (mine.length + 1)), `${label}: صافي تحصيل الحجز ${b.id} (${net}) = المدفوع (${b.amountPaid})`).toBe(true);
            if (!negOk.has(b.id)) {
              const by = new Map();
              mine.forEach((x) => { const k = [x.collectionMethod, x.paymentDetails?.senderName || "", x.paymentDetails?.senderNumber || ""].join("|"); by.set(k, (by.get(k) || 0) + (Number(x.collectionAmt) || 0)); });
              by.forEach((v, k) => expect(v >= -0.02, `${label}: رصيد وسيلة سالب على حجز ${b.id} (${k}) = ${v}`).toBe(true));
            }
            if (b.extras?.cafeteriaPaid != null) expect(Number(b.extras.cafeteriaPaid) <= Number(b.extras.cafeteria || 0) + 1e-9 + 0, `${label}: cafeteriaPaid ≤ cafeteria`).toBe(true);
          }
          const active = bs.filter((b) => b.status !== "ملغي" && b.checkout > b.checkin);
          for (const room of ROOMS) {
            const rs = active.filter((b) => b.room === room).sort((a, b) => (a.checkin < b.checkin ? -1 : 1));
            for (let i = 1; i < rs.length; i++) expect(rs[i].checkin >= rs[i - 1].checkout, `${label}: تداخل على غرفة ${room}`).toBe(true);
          }
          for (const e of staff) {
            expect(e.paid, `${label}: مدفوع الاستاف ≤ المبلغ`).toBeLessThanOrEqual(e.amount + 1e-9);
            expect(near(e.payments.reduce((a, p) => a + Number(p.amount || 0), 0), e.paid), `${label}: payments = paid`).toBe(true);
          }
        };

        const must = (res, what) => { if (!res.ok) throw new Error(`${what} فشلت: ${res.err?.message}`); return res.r; };
        const allowedErr = (res, pattern, what) => { if (!res.ok && !pattern.test(String(res.err?.message) + String(res.err?.code))) throw new Error(`${what} فشلت بسبب غير متوقع: ${res.err?.message}`); return res.ok; };

        const ops = {
          async create() {
            const room = pick(ROOMS), start = pick([-2, -1, 0, 0, 1, 2, 3]), nights = pick([1, 2, 3, 4]);
            const price = pick([50, 80, 100, 150, 200]), currency = pick(["USD", "USD", "EGP"]);
            const online = rnd() < 0.15;
            const cafe = pick([0, 0, 20, 40]);
            const ci = addDays(today, start), co = addDays(today, start + nights);
            const extras = { laundry: 0, cafeteria: cafe, tours: pick([0, 0, 15]), pickup: 0 };
            const pd = { senderName: "", senderNumber: "", ref: online ? "BK" : "", onlinePaid: online };
            record("create", `r${room} ${ci}→${co} ${price}${currency}${online ? " online" : ""} cafe${cafe}`);
            const res = await db.tx("st1", (c) => c.query(`insert into bookings(room, guest_name, checkin, checkout, price_night, total_room, currency, extras, payment_details, source, status) values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,'مباشر','مؤكد')`, [room, `G${log.length}`, ci, co, price, price * nights, currency, JSON.stringify(extras), JSON.stringify(pd)]));
            allowedErr(res, /23P01|bookings_no_overlap|exclusion/, "create");
          },
          async pay() {
            const bs = (await bookings()).filter((b) => b.status !== "ملغي" && b.checkout > b.checkin && b.checkin <= addDays(today, 2) && today < b.checkout && bookingHotelTotal(b) - b.amountPaid > 0.005);
            if (!bs.length) return;
            const b = pick(bs);
            const due = r2(bookingHotelTotal(b) - b.amountPaid);
            const amount = rnd() < 0.4 ? due : Math.max(0.01, r2(due * (0.1 + rnd() * 0.8)));
            const { method, details } = randomPayment();
            const split = splitPaymentForCafeteria(b, amount);
            const extras = split.cafeteria > 0 ? { ...b.extras, cafeteriaPaid: (Number(b.extras.cafeteriaPaid) || 0) + split.cafeteria } : b.extras;
            record("pay", `${b.id.slice(0, 4)} ${amount}/${due} ${method}${describePaymentDetails(method, details) ? " " + describePaymentDetails(method, details) : ""} cafe${split.cafeteria}`);
            if (RPC) { must(await db.tx(pick(STAFF), (c) => c.query("select record_booking_payment($1, $2, $3, $4::jsonb, null, 'تحصيل') r", [b.id, amount, method, JSON.stringify(details)])), "pay(rpc)"); return; }
            const res = await db.tx("st1", async (c) => {
              await c.query("update bookings set amount_paid = amount_paid + $2, payment_method = $3, extras = $4::jsonb where id = $1", [b.id, amount, method, JSON.stringify(extras)]);
              await ledgerApply(c, (rec) => {
                const room = applyCollectionToRows(rec.rows, { id: `p${log.length}`, bookingId: b.id, room: b.room, guestName: b.guestName, amount: process.env.SIM_MUTATE === "double" ? amount : amount - split.cafeteria, currency: b.currency, method, details, note: "تحصيل" }).rows;   // SIM_MUTATE=double: عطل متعمّد للتأكد إن المحاكي بيكتشف الأخطاء
                const caf = split.cafeteria > 0 ? applyCafeteriaCollection(rec.cafeteriaRows, { kind: "guest", bookingId: b.id, room: b.room, who: b.guestName, amount: split.cafeteria, currency: b.currency, method, details, note: "خدمة كافيتيريا" }).rows : rec.cafeteriaRows;
                return { rows: room, cafeteriaRows: caf, bookingCollections: [...rec.bookingCollections, { id: `p${log.length}`, bookingId: b.id }] };
              });
            });
            must(res, "pay");
          },
          async extras() {
            const bs = (await bookings()).filter((b) => b.status !== "ملغي" && b.checkin <= today && today < b.checkout && !b.paymentDetails?.onlinePaid);
            if (!bs.length) return;
            const b = pick(bs);
            const extras = { ...b.extras, cafeteria: Number(b.extras.cafeteria || 0) + pick([0, 10, 25]), tours: Number(b.extras.tours || 0) + pick([0, 0, 20]) };
            record("extras", `${b.id.slice(0, 4)} cafe${extras.cafeteria} tours${extras.tours}`);
            must(await db.tx("st1", (c) => c.query("update bookings set extras = $2::jsonb where id = $1", [b.id, JSON.stringify(extras)])), "extras");
          },
          async earlyCheckin() {
            const bs = (await bookings()).filter((b) => b.status !== "ملغي" && b.checkin <= today && today < b.checkout && !b.earlyCheckin?.applied);
            if (!bs.length) return;
            const b = pick(bs), fee = pick([20, 40]), collect = rnd() < 0.6, { method, details } = randomPayment();
            record("earlyCheckin", `${b.id.slice(0, 4)} ${fee} ${collect ? method : "later"}`);
            const ecRes = await db.tx("st1", async (c) => {
              await c.query("update bookings set early_checkin = $2::jsonb where id = $1", [b.id, JSON.stringify({ applied: true, fee, note: "" })]);
              if (collect && RPC) {
                await c.query("select record_booking_payment($1, $2, $3, $4::jsonb, null, 'رسم دخول مبكر')", [b.id, fee, method, JSON.stringify(details)]);
              } else if (collect) {
                await c.query("update bookings set amount_paid = amount_paid + $2, payment_method = $3 where id = $1", [b.id, fee, method]);
                await ledgerApply(c, (rec) => ({ ...rec, rows: applyCollectionToRows(rec.rows, { id: `e${log.length}`, bookingId: b.id, room: b.room, guestName: b.guestName, amount: fee, currency: b.currency, method, details, note: "رسم دخول مبكر" }).rows, bookingCollections: [...rec.bookingCollections, { id: `e${log.length}`, bookingId: b.id }] }));
              }
            });
            // الحجز متدفوع زيادة (غادر مبكرًا / قُصّر) فمفيش متبقي يتحصّل عليه الرسم: الـ RPC بترفض والعملية كلها بتترجع (مفيش نص-نص)
            allowedErr(ecRes, /أكبر من المتبقي/, "earlyCheckin");
          },
          async extend() {
            const bs = (await bookings()).filter((b) => b.status !== "ملغي" && b.checkin <= today && today < b.checkout);
            if (!bs.length) return;
            const b = pick(bs), n = pick([1, 2]), co = addDays(b.checkout, n), total = repricedTotalRoom(b, b.checkin, co);
            record("extend", `${b.id.slice(0, 4)} +${n}`);
            const res = await db.tx(pick(["st1", "res1"]), (c) => c.query("update bookings set checkout = $2, total_room = $3 where id = $1", [b.id, co, total]));
            allowedErr(res, /23P01|bookings_no_overlap|exclusion/, "extend");
          },
          async shorten() {
            const bs = (await bookings()).filter((b) => b.status !== "ملغي" && !b.leftEarly && b.checkout > addDays(b.checkin, 1));
            if (!bs.length) return;
            const b = pick(bs), keep = 1 + Math.floor(rnd() * (Math.round((Date.parse(b.checkout) - Date.parse(b.checkin)) / 864e5) - 1)), co = addDays(b.checkin, keep);
            record("shorten", `${b.id.slice(0, 4)} →${co}`);
            must(await db.tx("res1", (c) => c.query("update bookings set checkout = $2, total_room = $3 where id = $1", [b.id, co, repricedTotalRoom(b, b.checkin, co)])), "shorten");
          },
          async cancel() {
            const bs = (await bookings()).filter((b) => b.status !== "ملغي");
            if (!bs.length) return;
            const b = pick(bs);
            record("cancel", `${b.id.slice(0, 4)} paid${b.amountPaid}`);
            must(await db.tx("res1", (c) => c.query("update bookings set status = 'ملغي' where id = $1", [b.id])), "cancel");
          },
          async decide() {
            const bs = (await bookings()).filter((b) => b.refundPending);
            if (!bs.length) return;
            const b = pick(bs), decision = rnd() < 0.7 ? "refund" : "keep", method = pick(PAYMENT_METHODS);
            // هل الوسيلة المختارة معاها رصيد على الحجز؟ (لو لأ، قرار المدير بيمشي وسالب مسموح)
            const [led] = await db.q("select rows, cafeteria_rows from shift_records");
            const hasBal = [...led.rows, ...led.cafeteria_rows].filter((x) => x.bookingId === b.id && x.collectionMethod === method && (x.collectionCurrency || "EGP") === b.currency).reduce((a, x) => a + (Number(x.collectionAmt) || 0), 0) > 0.005;
            record("decide", `${b.id.slice(0, 4)} ${decision} ${method} bal=${hasBal}`);
            const res = await db.tx("res1", (c) => c.query("select decide_booking_refund($1, $2, null, $3) r", [b.id, decision, method]));
            must(res, "decide");
            if (decision === "refund" && !hasBal) negOk.add(b.id);
          },
          async earlyLeave() {
            const bs = (await bookings()).filter((b) => b.status !== "ملغي" && b.checkin <= today && today < b.checkout);
            if (!bs.length) return;
            const b = pick(bs), p = earlyLeavePatch(b, today, "plain");
            record("earlyLeave", `${b.id.slice(0, 4)} →${today}`);
            must(await db.tx("st1", (c) => c.query("update bookings set checkout = $2, total_room = $3, status = $4, left_early = true, notes = $5 where id = $1", [b.id, p.checkout, p.totalRoom, p.status, p.notes])), "earlyLeave");
          },
          async staffAdd() {
            const amount = pick([10, 25, 40, 60]), currency = pick(["EGP", "EGP", "USD"]);
            const payNow = rnd() < 0.4, { method, details } = randomPayment();
            const consumer = pick(["سارة", "منى", "حسن"]);
            record("staffAdd", `${consumer} ${amount}${currency} ${payNow ? method : "later"}`);
            if (RPC) { must(await db.tx(pick(STAFF), (c) => c.query("select record_staff_cafeteria($1, null, 'x', $2, $3, $4, $5::jsonb) r", [consumer, amount, currency, payNow ? method : null, JSON.stringify(details)])), "staffAdd(rpc)"); return; }
            must(await db.tx("st1", async (c) => {
              const payments = payNow ? [{ amount, method, details, day: today, shiftKey: SHIFT }] : [];
              await c.query("insert into staff_cafeteria(day, shift_key, consumer_name, description, amount, currency, paid_amount, payments) values ($1,$2,$3,'x',$4,$5,$6,$7::jsonb)", [today, SHIFT, consumer, amount, currency, payNow ? amount : 0, JSON.stringify(payments)]);
              if (payNow) await ledgerApply(c, (rec) => ({ ...rec, cafeteriaRows: applyCafeteriaCollection(rec.cafeteriaRows, { kind: "staff", consumerKey: consumer, who: consumer, amount, currency, method, details, note: "كافيتيريا استاف" }).rows }));
            }), "staffAdd");
          },
          async staffPay() {
            const es = await db.q("select id, consumer_name, amount::float amount, paid_amount::float paid, currency, payments from staff_cafeteria where paid_amount < amount");
            if (!es.length) return;
            const e = pick(es), owed = r2(e.amount - e.paid), amount = rnd() < 0.5 ? owed : Math.max(0.01, r2(owed * (0.2 + rnd() * 0.6)));
            const { method, details } = randomPayment();
            record("staffPay", `${e.consumer_name} ${amount}/${owed} ${method}`);
            if (RPC) { must(await db.tx(pick(STAFF), (c) => c.query("select settle_staff_cafeteria($1, null, $2, $3, $4, $5::jsonb) r", [e.consumer_name, e.currency, amount, method, JSON.stringify(details)])), "staffPay(rpc)"); return; }
            must(await db.tx("st1", async (c) => {
              await c.query("update staff_cafeteria set paid_amount = paid_amount + $2, payments = payments || $3::jsonb where id = $1", [e.id, amount, JSON.stringify([{ amount, method, details, day: today, shiftKey: SHIFT }])]);
              await ledgerApply(c, (rec) => ({ ...rec, cafeteriaRows: applyCafeteriaCollection(rec.cafeteriaRows, { kind: "staff", consumerKey: e.consumer_name, who: e.consumer_name, amount, currency: e.currency, method, details, note: "كافيتيريا استاف" }).rows }));
            }), "staffPay");
          },
        };
        const weights = [["create", 5], ["pay", 8], ["extras", 3], ["earlyCheckin", 2], ["extend", 3], ["shorten", 3], ["cancel", 2], ["decide", 5], ["earlyLeave", 2], ["staffAdd", 3], ["staffPay", 3]];
        const bag = weights.flatMap(([k, w]) => Array(w).fill(k));
        for (let i = 0; i < 8; i++) await ops.create();
        await check("بداية");
        for (let step = 0; step < OPS; step++) {
          const op = pick(bag);
          await ops[op]();
          await check(`خطوة ${step + 1} (${log[log.length - 1] || op})`);
        }
      } catch (e) {
        e.message = `[seed ${seed}] ${e.message}\nآخر العمليات:\n  ${log.slice(-15).join("\n  ")}`;
        throw e;
      } finally {
        console.log(`seed ${seed}:`, JSON.stringify(stats));
        await db.close();
      }
    });
  }
});
