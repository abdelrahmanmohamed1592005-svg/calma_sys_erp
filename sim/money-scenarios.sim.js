/*
  سيناريوهات الفلوس واللخبطة (قرار المالك: "الماليات ومشاكلها ... ظبطها"): محاكي عشوائي على قاعدة حقيقية
  بأدوار حقيقية - دفع بنفس العملة وبعملات تانية (بسعر الحجز بالمصري، حتى عملتين مش مصري)، دفع زيادة،
  تحديد/تغيير سعر العملة، تصحيح دفعات (تغيير مبلغ، تقسيم على وسيلة/عملة تانية، تصفير = الصف بيتشال)
  في الشيفت المفتوح والشيفتات المقفولة النهارده (الموظف ومدير الشيفت)، إقفال شيفت وفتح اللي بعده بالعهدة،
  تغيير عملة الحجز، والإلغاء. بعد كل عملية بنفحص:
   - المدفوع على كل حجز = تحصيله في كل اليوميات (عملة الحجز + مقابل دفعات سعر الصرف) بالظبط.
   - الخدمات بعملة تانية: other_paid = تحصيلها بنفس العملة.
   - كل صف بسعر صرف: المقابل = المبلغ ÷ السعر.
   - الشيفت المقفول: رصيد إقفاله المتسجّل = الحساب من صفوفه، والشيفت اللي بعده عهدته = رصيد إقفاله.
*/
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { enabled, buildTemplate, dropTemplate, newDb, mulberry32 } from "./helpers.js";
import { computeShiftTotals, cascadeHandover, bookingFxRate, currencyKeysOf } from "../src/domain/money.js";
import { addDays } from "../src/domain/dates.js";

const SEEDS = Number(process.env.SIM_SEEDS || 6);
const OPS = Number(process.env.SIM_OPS || 120);
const ROOMS = [601, 602, 603, 604, 605, 606];
const KEYS = ["morning", "evening", "night"];
const r2 = (n) => Math.round(n * 100) / 100;
const near = (a, b, t) => Math.abs(a - b) <= t;

const toRec = (r) => ({ date: r.date, shiftKey: r.shift_key, rows: r.rows || [], cafeteria: r.cafeteria || {}, cafeteriaRows: r.cafeteria_rows || [], hotelRows: r.hotel_rows || [],
  handover: r.handover, methodHandover: r.method_handover || {}, closed: r.closed, updatedAt: r.updated_at, closingCash: r.closing_cash, methodClosing: r.method_closing });
const totalsPatch = (t) => ({ total_expenses: t.totalExpenses, total_collections: t.totalCollections, closing_cash: t.closingCash, cash_collections: t.cashCollections,
  by_method_currency: t.byMethodCurrency, by_category: t.byCategory, method_closing: t.methodClosing });
const sameMoney = (a, b) => currencyKeysOf(a, b).every((c) => near(Number(a?.[c]) || 0, Number(b?.[c]) || 0, 0.011));

describe.skipIf(!enabled)("سيناريوهات الفلوس واللخبطة", () => {
  beforeAll(async () => { await buildTemplate(); });
  afterAll(async () => { await dropTemplate(); });

  for (let s = 0; s < SEEDS; s++) {
    const seed = 5000 + s * 104729;
    it(`seed ${seed}: ${OPS} عملية فلوس مختلطة والحسابات سليمة بعد كل واحدة`, async () => {
      const db = await newDb();
      const rnd = mulberry32(seed);
      const pick = (a) => a[Math.floor(rnd() * a.length)];
      const log = [];
      try {
        for (const [u, role] of [["sm1", "shift_manager"], ["dv1", "dev"], ["st3", "staff"]]) {
          const [{ id }] = await db.q("insert into auth.users(id, email) values (gen_random_uuid(), $1) returning id", [`${u}@calma.internal`]);
          db.ids[u] = id;
          await db.q("insert into profiles(id, username, name, role) values ($1, $2, $2, $3)", [id, u, role]);
        }
        const [{ today, sday }] = await db.q("select hotel_today()::text today, calma_shift_day()::text sday");
        const day = sday;                       // كل الشيفتات في يوم الشيفت الحالي (الموظف يصحّح فيه حتى المقفول)
        let keyIdx = 0;
        const STAFF = ["st1", "st2", "st3"];         // موظف لكل شيفت (اختيار واحد في اليوم لكل موظف)
        const staffNow = () => STAFF[keyIdx];
        const openShift = async (handover = {}, methodHandover = {}) => {
          const key = KEYS[keyIdx], u = STAFF[keyIdx];
          await db.q("insert into shift_claims(date, shift_key, username, name) values ($1, $2, $3, $3)", [day, key, u]);
          await db.q("insert into shift_records(date, shift_key, staff_name, staff_username, rows, cafeteria_rows, handover, method_handover) values ($1, $2, $6, $6, $3::jsonb, '[]'::jsonb, $4::jsonb, $5::jsonb)",
            [day, key, JSON.stringify(ROOMS.map((room) => ({ room, collectionAmt: "", collectionCurrency: "EGP", collectionMethod: "كاش", expenseAmt: "", expenseCurrency: "EGP" }))), JSON.stringify(handover), JSON.stringify(methodHandover), u]);
        };
        await openShift({ EGP: 100 });
        const record = (op, extra = "") => log.push(`${op}${extra ? " " + extra : ""}`);
        const bookings = async () => db.q("select id, room, currency, total_room::float total, amount_paid::float paid, other_paid, other_charges, fx_rates, status, payment_details from bookings order by created_at");
        // updated_at كنص كامل (ميكروثانية) - زي ما الشاشة بتبعته؛ Date بتاع JS بيقصّه لملّي ثانية فالتعارض بيتحسب غلط
        const shifts = async () => db.q("select *, updated_at::text updated_at from shift_records order by date, case shift_key when 'morning' then 0 when 'evening' then 1 else 2 end");
        const asB = (b) => ({ id: b.id, currency: b.currency, fxRates: b.fx_rates || {}, otherCharges: b.other_charges || {} });

        const check = async (label) => {
          const bs = await bookings();
          const recs = await shifts();
          const all = recs.flatMap((r) => [...(r.rows || []), ...(r.cafeteria_rows || [])]);
          for (const b of bs) {
            const mine = all.filter((x) => x.bookingId === b.id);
            const main = mine.reduce((a, x) => a + (String(x.fxBookingCurrency || "").trim() ? Number(x.fxCovered) || 0 : (x.collectionCurrency || "EGP") === b.currency ? Number(x.collectionAmt) || 0 : 0), 0);
            const prior = Number(b.payment_details?.priorPaid) || 0;
            expect(near(main + prior, b.paid, 0.011 * (mine.length + 1)), `${label}: مدفوع الحجز ${b.id.slice(0, 6)} (${b.paid}) = تحصيله في اليوميات (${r2(main + prior)})`).toBe(true);
            expect(b.paid, `${label}: مدفوع سالب`).toBeGreaterThanOrEqual(-0.001);
            const other = {};
            mine.forEach((x) => { const c = x.collectionCurrency || "EGP"; if (!String(x.fxBookingCurrency || "").trim() && c !== b.currency) other[c] = (other[c] || 0) + (Number(x.collectionAmt) || 0); });
            currencyKeysOf(other, b.other_paid).forEach((c) => expect(near(other[c] || 0, Number(b.other_paid?.[c]) || 0, 0.011 * (mine.length + 1)), `${label}: other_paid ${c} على ${b.id.slice(0, 6)}`).toBe(true));
          }
          for (const x of all) {
            if (!String(x.fxBookingCurrency || "").trim() || !(Number(x.collectionAmt) || 0)) continue;
            const ok = near(Number(x.fxCovered), Number(x.collectionAmt) / Number(x.fxRate), 0.011) || near(Number(x.fxCovered) * Number(x.fxRate), Number(x.collectionAmt), 0.011);
            expect(ok, `${label}: صف سعر صرف مقابله غلط ${JSON.stringify(x)}`).toBe(true);
          }
          for (let i = 0; i < recs.length; i++) {
            const r = recs[i];
            if (!r.closed) continue;
            const t = computeShiftTotals(toRec(r));
            expect(sameMoney(r.closing_cash, t.closingCash), `${label}: رصيد إقفال ${r.shift_key} المتسجّل ${JSON.stringify(r.closing_cash)} = المحسوب ${JSON.stringify(t.closingCash)}`).toBe(true);
            const next = recs[i + 1];
            if (next) expect(sameMoney(next.handover, t.closingCash), `${label}: عهدة ${next.shift_key} (${JSON.stringify(next.handover)}) = إقفال ${r.shift_key} (${JSON.stringify(t.closingCash)})`).toBe(true);
          }
        };

        // تصحيح يومية بنفس مسار الشاشة (applyCorrection): الأرقام لو مقفولة + نقل العهدة للي بعدها
        const correct = async (actor, row, nextRec) => {
          const oldT = computeShiftTotals(toRec(row)), newT = computeShiftTotals(nextRec);
          const payload = { rows: nextRec.rows, cafeteria_rows: nextRec.cafeteriaRows, ...(row.closed ? totalsPatch(newT) : {}) };
          const res = await db.tx(actor, (c) => c.query("select correct_shift_record(1, $1, $2, $3, $4::jsonb) r", [row.date, row.shift_key, row.updated_at, JSON.stringify(payload)]));
          if (!res.ok) return res;
          if (res.r.rows[0].r?.conflict) return { ok: false, err: new Error("تعارض (اليومية اتغيّرت)") };
          const recs = await shifts();
          const idx = recs.findIndex((r) => r.shift_key === row.shift_key && String(r.date) === String(row.date));
          for (const rec of cascadeHandover(recs.slice(idx + 1).map(toRec), oldT, newT)) {
            const fresh = recs.find((r) => r.shift_key === rec.shiftKey);
            const p = { handover: rec.handover, method_handover: rec.methodHandover, ...(rec.closed ? totalsPatch(computeShiftTotals(rec)) : {}) };
            const r2x = await db.tx(actor, (c) => c.query("select correct_shift_record(1, $1, $2, $3, $4::jsonb) r", [fresh.date, fresh.shift_key, fresh.updated_at, JSON.stringify(p)]));
            if (!r2x.ok) return r2x;
            if (r2x.r.rows[0].r?.conflict) return { ok: false, err: new Error("تعارض في نقل العهدة") };
          }
          return res;
        };
        const must = (res, what) => { if (!res.ok) throw new Error(`${what} فشلت: ${res.err?.message}`); return res.r; };
        const allowed = (res, re, what) => { if (!res.ok && !re.test(String(res.err?.message))) throw new Error(`${what} فشلت بسبب غير متوقع: ${res.err?.message}`); return res.ok; };
        const live = async () => (await bookings()).filter((b) => b.status !== "ملغي");

        const ops = {
          async create() {
            const room = pick(ROOMS), nights = pick([1, 2, 3]), price = pick([32, 50, 100, 900, 1500]), currency = pick(["USD", "EGP", "EUR"]);
            record("create", `r${room} ${price}${currency}×${nights}`);
            const res = await db.tx(staffNow(), (c) => c.query("insert into bookings(room, guest_name, checkin, checkout, price_night, total_room, currency, source, status) values ($1, $2, $3, $4, $5, $6, $7, 'مباشر', 'تم تسجيل الدخول')",
              [room, `G${log.length}`, today, addDays(today, nights), price, price * nights, currency]));
            allowed(res, /bookings_no_overlap|exclusion|23P01|متداخلة/, "create");
          },
          async pay() {
            const bs = await live(); if (!bs.length) return;
            const b = pick(bs);
            const due = Math.max(0, b.total - b.paid);
            const amount = r2(pick([due, due * 0.5, due + 3, 35, 7.5]) || 10);
            if (!(amount > 0)) return;
            record("pay", `${b.id.slice(0, 6)} ${amount} ${b.currency}`);
            must(await db.tx(staffNow(), (c) => c.query("select record_booking_payment($1, $2, 'كاش', '{}'::jsonb, null, 'تحصيل') r", [b.id, amount])), "pay");
          },
          async setRate() {
            const bs = await live(); if (!bs.length) return;
            const b = pick(bs), cur = pick(["USD", "EUR"]), v = pick([47.5, 50, 54, 55.25]);
            record("rate", `${b.id.slice(0, 6)} ${cur}=${v}`);
            must(await db.tx(pick([staffNow(), "sm1"]), (c) => c.query("select set_booking_fx_rate($1, $2, $3) r", [b.id, cur, v])), "rate");
          },
          async payFx() {
            const bs = (await live()).filter((b) => ["EGP", "USD", "EUR"].some((c) => c !== b.currency && bookingFxRate(asB(b), c)));
            if (!bs.length) return;
            const b = pick(bs);
            const cur = pick(["EGP", "USD", "EUR"].filter((c) => c !== b.currency && bookingFxRate(asB(b), c)));
            const amount = pick([10, 37, 108, 500, 2000]);
            record("payFx", `${b.id.slice(0, 6)} ${amount} ${cur} → ${b.currency}`);
            must(await db.tx(staffNow(), (c) => c.query("select record_booking_payment_fx($1, $2, $3, null, 'كاش', '{}'::jsonb, null, 'تحصيل') r", [b.id, amount, cur])), "payFx");
          },
          async correctRow() {
            const recs = await shifts();
            const cands = recs.flatMap((r) => (r.rows || []).map((x, idx) => ({ r, x, idx })).filter(({ x }) => x.bookingId && (Number(x.collectionAmt) || 0) !== 0));
            if (!cands.length) return;
            const { r, x, idx } = pick(cands);
            const [b] = (await bookings()).filter((bk) => bk.id === x.bookingId);
            if (!b) return;
            const bk = asB(b);
            const actor = pick([staffNow(), "sm1"]);            // الموظف الشغّال بيصحّح أي شيفت النهارده (حتى المقفول)، ومدير الشيفت
            const action = pick(["amount", "zero", "split", "split", "method"]);
            const { fxCovered: _a, fxRate: _b, fxBookingCurrency: _c, ...base } = x;
            const rowFor = (amt, cur, method) => {
              const row = { ...base, collectionAmt: amt, collectionCurrency: cur, collectionMethod: method };
              const keepOld = Number(x.fxRate) > 0 && x.fxBookingCurrency === b.currency && cur === x.collectionCurrency ? Number(x.fxRate) : null;
              const rate = cur !== b.currency && !(bk.otherCharges || {})[cur] ? keepOld || bookingFxRate(bk, cur) : null;
              if (cur !== b.currency && !(bk.otherCharges || {})[cur] && !rate) return null;     // الشاشة بتطلب السعر الأول
              if (rate) { const fr = Math.round(rate * 1e10) / 1e10; Object.assign(row, { fxRate: fr, fxBookingCurrency: b.currency, fxCovered: r2(amt / fr) }); }
              return row;
            };
            const rows = [...r.rows];
            let made;
            if (action === "zero") {
              rows.splice(idx, 1);
              if (!rows.some((y) => y.room === x.room)) rows.splice(idx, 0, { room: x.room, collectionAmt: "", collectionCurrency: "EGP", collectionMethod: "كاش", expenseAmt: "", expenseCurrency: "EGP" });
              made = "zero";
            } else if (action === "amount") {
              const nr = rowFor(r2(Math.max(0.5, Number(x.collectionAmt) * pick([0.5, 1.2, 2]))), x.collectionCurrency || "EGP", x.collectionMethod); if (!nr) return;
              rows.splice(idx, 1, nr); made = `amount ${nr.collectionAmt}`;
            } else if (action === "method") {
              const nr = rowFor(Number(x.collectionAmt), x.collectionCurrency || "EGP", pick(["فيزا", "كاش"])); if (!nr) return;
              rows.splice(idx, 1, nr); made = "method";
            } else {
              const half = r2(Number(x.collectionAmt) / 2);
              const otherCur = pick(["EGP", "USD", "EUR"]);
              const a = rowFor(half, x.collectionCurrency || "EGP", x.collectionMethod), c2 = rowFor(pick([half, 20, 108]), otherCur, "كاش");
              if (!a || !c2) return;
              rows.splice(idx, 1, a, c2); made = `split ${half} + ${c2.collectionAmt} ${otherCur}`;
            }
            record("correct", `${actor} ${r.shift_key}${r.closed ? "(مقفول)" : ""} ${b.id.slice(0, 6)} ${made}`);
            must(await correct(actor, r, { ...toRec(r), rows }), "correct");
          },
          async closeAndNext() {
            if (keyIdx >= KEYS.length - 1) return;
            const [r] = (await shifts()).filter((x) => !x.closed);
            const t = computeShiftTotals(toRec(r));
            record("close", r.shift_key);
            await db.q("update shift_records set closed = true, closed_by = 'st1', closed_at = now(), total_expenses = $3, total_collections = $4, closing_cash = $5, cash_collections = $6, by_method_currency = $7, by_category = $8, method_closing = $9 where date = $1 and shift_key = $2",
              [r.date, r.shift_key, ...Object.values(totalsPatch(t)).map((v) => JSON.stringify(v))]);
            keyIdx += 1;
            await openShift(t.closingCash, t.methodClosing);
          },
          async changeCurrency() {
            const bs = await live(); if (!bs.length) return;
            const b = pick(bs), cur = pick(["USD", "EGP", "EUR"].filter((c) => c !== b.currency));
            record("currency", `${b.id.slice(0, 6)} ${b.currency}→${cur}`);
            allowed(await db.tx(pick(["dv1", staffNow()]), (c) => c.query("select change_booking_currency($1, $2, null) r", [b.id, cur])), /خدمات أو مدفوع منفصل|أصلًا|يوم فات/, "currency");
          },
          async cancel() {
            const bs = await live(); if (bs.length < 3) return;
            const b = pick(bs);
            record("cancel", b.id.slice(0, 6));
            must(await db.tx("res1", (c) => c.query("update bookings set status = 'ملغي' where id = $1", [b.id])), "cancel");
          },
        };
        const weights = [["create", 3], ["pay", 5], ["setRate", 3], ["payFx", 4], ["correctRow", 6], ["closeAndNext", 1], ["changeCurrency", 2], ["cancel", 1]];
        const bag = weights.flatMap(([k, w]) => Array(w).fill(k));
        for (let i = 0; i < 4; i++) await ops.create();
        for (let i = 0; i < OPS; i++) {
          const op = pick(bag);
          await ops[op]();
          await check(`#${i} ${log[log.length - 1] || op}`);
        }
      } catch (e) {
        e.message = `seed ${seed}\n${log.slice(-15).join("\n")}\n${e.message}`;
        throw e;
      } finally { await db.close(); }
    }, 300_000);
  }
});
