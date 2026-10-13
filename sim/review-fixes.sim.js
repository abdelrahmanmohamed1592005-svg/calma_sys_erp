/*
  ثغرات لقيتها مراجعة الكود الكاملة (كل واحدة اتأكدت بتجربة على قاعدة حقيقية بهوية الدور الحقيقي) - لازم تفضل مقفولة.
*/
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { enabled, buildTemplate, dropTemplate, newDb } from "./helpers.js";
import { addDays } from "../src/domain/dates.js";

const emptyRow = (room) => ({ room, expenseDesc: "", expenseAmt: "", expenseCategory: "أخرى", expenseCurrency: "EGP", collectionDesc: "", collectionAmt: "", collectionMethod: "كاش", collectionCurrency: "EGP", paymentDetails: { senderName: "", senderNumber: "", ref: "", onlinePaid: false }, notes: "" });

describe.skipIf(!enabled)("إصلاحات المراجعة الكاملة", () => {
  let db, today;
  beforeAll(async () => { await buildTemplate(); db = await newDb(); [{ today }] = await db.q("select hotel_today()::text today"); });
  afterAll(async () => { await db?.close(); await dropTemplate(); });
  const booking = async (over = "", room = 601) => (await db.q(`insert into bookings(room, guest_name, checkin, checkout, price_night, total_room, currency, amount_paid ${over ? ", " + over.split("|")[0] : ""}) values (${room}, 'G', $1, $2, 100, 200, 'EGP', 200 ${over ? ", " + over.split("|")[1] : ""}) returning id`, [today, addDays(today, 2)]))[0].id;

  it("مدير الحجوزات: إعادة فتح يومية مقفولة لوحدها مسموحة، لكن مع تعديل الصفوف/الأرصدة مرفوضة", async () => {
    const rows = [{ ...emptyRow(601), collectionAmt: 500, collectionMethod: "كاش", collectionCurrency: "EGP", collectionDesc: "x" }];
    await db.q("insert into shift_records(date, shift_key, staff_name, staff_username, rows, closed, closing_cash) values ($1,'morning','st1','st1',$2::jsonb,true,'{\"EGP\":500}'::jsonb)", [today, JSON.stringify(rows)]);
    const tamper = await db.tx("res1", (c) => c.query("update shift_records set closed = false, rows = '[]'::jsonb where shift_key = 'morning'"));
    expect(tamper.ok).toBe(false);
    const tamper2 = await db.tx("res1", (c) => c.query("update shift_records set closed = false, closing_cash = '{\"EGP\":0}'::jsonb where shift_key = 'morning'"));
    expect(tamper2.ok).toBe(false);
    const [s] = await db.q("select closed, jsonb_array_length(rows) n from shift_records where shift_key='morning'");
    expect(s).toEqual({ closed: true, n: 1 });                                  // ولا حاجة اتغيّرت
    const reopen = await db.tx("res1", (c) => c.query("update shift_records set closed = false where shift_key = 'morning'"));
    expect(reopen.ok).toBe(true);                                               // الإعادة لوحدها (الوظيفة الأصلية) شغّالة
    expect((await db.q("select closed from shift_records where shift_key='morning'"))[0].closed).toBe(false);
    await db.q("update shift_records set closed = true where shift_key = 'morning'");
    const gm = await db.tx("gm1", (c) => c.query("update shift_records set closed = false, shift_notes = 'تصحيح' where shift_key = 'morning'"));
    expect(gm.ok).toBe(true);                                                   // المدير العام يقدر يعيد الفتح ويصحّح
    await db.q("delete from shift_records");
  });

  it("تغيير عملة حجز عليه مدفوع مرفوض لأي دور (مدير حجوزات، مدير عام)، ومسموح لحجز مفيش عليه فلوس", async () => {
    const id = await booking();
    for (const u of ["res1", "gm1"]) {
      await db.tx(u, (c) => c.query("update bookings set currency = 'USD' where id = $1", [id]));   // مرفوض بخطأ أو بصفر صفوف حسب سياسة الدور
      expect((await db.q("select currency from bookings where id = $1", [id]))[0].currency, u).toBe("EGP");
    }
    expect((await db.q("select currency from bookings where id = $1", [id]))[0].currency).toBe("EGP");
    const free = (await db.q("insert into bookings(room, guest_name, checkin, checkout, price_night, total_room, currency) values (602,'Free',$1,$2,100,100,'EGP') returning id", [today, addDays(today, 1)]))[0].id;
    expect((await db.tx("res1", (c) => c.query("update bookings set currency = 'USD' where id = $1", [free]))).ok).toBe(true);
  });

  it("حجز مدفوع أونلاين (مدفوعه صفر) مينفعش يتمسح - زي أي حجز عليه فلوس", async () => {
    const id = (await db.q("insert into bookings(room, guest_name, checkin, checkout, price_night, total_room, currency, payment_details) values (603,'Online',$1,$2,100,100,'EGP','{\"onlinePaid\":true,\"ref\":\"R1\",\"senderName\":\"\",\"senderNumber\":\"\"}'::jsonb) returning id", [today, addDays(today, 1)]))[0].id;
    expect((await db.tx("res1", (c) => c.query("delete from bookings where id = $1", [id]))).ok).toBe(false);
    expect(await db.q("select 1 from bookings where id = $1", [id])).toHaveLength(1);
  });

  it("رد فلوس بوسيلة مش من القايمة مرفوض ومفيش حاجة بتتغيّر (الأرصدة الحقيقية مش بتتساب)", async () => {
    const id = await booking("", 605);
    await db.q("update bookings set status = 'ملغي' where id = $1", [id]);
    await db.q("update bookings set refund_pending = true where id = $1", [id]);
    await db.q("insert into shift_claims(date, shift_key, username, name) values ($1,'evening','st1','st1') on conflict do nothing", [today]);
    await db.q("insert into shift_records(date, shift_key, staff_name, staff_username, rows) values ($1,'evening','st1','st1',$2::jsonb)", [today, JSON.stringify([{ ...emptyRow(605), bookingId: id, collectionAmt: 200, collectionMethod: "كاش", collectionCurrency: "EGP", collectionDesc: "x" }])]);
    const bad = await db.tx("res1", (c) => c.query("select decide_booking_refund($1, 'refund', null, 'xyz') r", [id]));
    expect(bad.ok).toBe(false);
    expect(String(bad.err?.message)).toMatch(/وسيلة الدفع/);
    expect((await db.q("select refund_pending, amount_paid::float p from bookings where id = $1", [id]))[0]).toEqual({ refund_pending: true, p: 200 });
    const ok = await db.tx("res1", (c) => c.query("select decide_booking_refund($1, 'refund', null, 'كاش') r", [id]));
    expect(ok.ok).toBe(true);
    const [rec] = await db.q("select rows from shift_records where shift_key='evening'");
    expect(rec.rows.filter((r) => r.bookingId === id).reduce((a, r) => a + Number(r.collectionAmt), 0)).toBe(0);
    await db.q("delete from shift_records"); await db.q("delete from shift_claims");
  });

  it("حفظ الرسوم الإضافية من بطاقة الغرفة (extras من غير cafeteriaPaid) ما بيمسحش اللي اتحصّل من كافيتيريا النزيل", async () => {
    await db.q("insert into shift_claims(date, shift_key, username, name) values ($1,'morning','st1','st1') on conflict do nothing", [today]);
    await db.q("insert into shift_records(date, shift_key, staff_name, staff_username, rows) values ($1,'morning','st1','st1','[]'::jsonb) on conflict do nothing", [today]);
    const id = (await db.q("insert into bookings(room, guest_name, checkin, checkout, price_night, total_room, currency, extras) values (606,'Cafe',$1,$2,100,200,'EGP','{\"laundry\":0,\"cafeteria\":100,\"tours\":0,\"pickup\":0}'::jsonb) returning id", [today, addDays(today, 2)]))[0].id;
    const p = await db.tx("st1", (c) => c.query("select record_booking_payment($1, 150, 'كاش', '{}'::jsonb, null, 'تحصيل') r", [id]));
    expect(p.ok, String(p.err?.message)).toBe(true);
    const cp = async () => Number((await db.q("select extras ->> 'cafeteriaPaid' v from bookings where id = $1", [id]))[0].v);
    expect(await cp()).toBe(100);
    // نفس اللي كانت بتبعته الواجهة: extras بأربع خانات من غير cafeteriaPaid
    await db.tx("st1", (c) => c.query("update bookings set extras = '{\"laundry\":0,\"cafeteria\":100,\"tours\":20,\"pickup\":0}'::jsonb where id = $1", [id]));
    expect(await cp()).toBe(100);
    expect((await db.q("select extras ->> 'tours' t from bookings where id = $1", [id]))[0].t).toBe("20");      // وباقي التعديل اتحفظ عادي
    // محاولة تصفير/تزوير مباشرة
    for (const v of [0, 5, 1000]) await db.tx("st1", (c) => c.query("update bookings set extras = jsonb_set(extras, '{cafeteriaPaid}', to_jsonb($2::numeric)) where id = $1", [id, v]));
    expect(await cp()).toBe(100);
    await db.q("delete from shift_records"); await db.q("delete from shift_claims");
  });

  it("قفل الكتابة المباشرة: مفيش دور بيغيّر amount_paid ولا ديون الكافيتيريا بتحديث/إضافة مباشرة، والدوال الذرية شغّالة، والصيانة (من غير مستخدم) مسموحة", async () => {
    await db.q("insert into shift_claims(date, shift_key, username, name) values ($1,'morning','st1','st1') on conflict do nothing", [today]);
    await db.q("insert into shift_records(date, shift_key, staff_name, staff_username, rows) values ($1,'morning','st1','st1','[]'::jsonb) on conflict do nothing", [today]);
    const id = (await db.q("insert into bookings(room, guest_name, checkin, checkout, price_night, total_room, currency) values (607,'Lock',$1,$2,100,200,'EGP') returning id", [today, addDays(today, 2)]))[0].id;
    const paid = async () => Number((await db.q("select amount_paid::float p from bookings where id = $1", [id]))[0].p);
    for (const u of ["st1", "st2", "res1", "gm1", "acc1"]) {
      const r = await db.tx(u, (c) => c.query("update bookings set amount_paid = 50 where id = $1", [id]));
      expect(await paid(), `${u} كتب amount_paid مباشرة`).toBe(0);
      if (r.ok === false) expect(String(r.err?.message), u).toMatch(/مش بتعديل مباشر/);
    }
    // إنشاء حجز بمدفوع مباشرة ممنوع برضه
    const ins = await db.tx("st1", (c) => c.query("insert into bookings(room, guest_name, checkin, checkout, price_night, total_room, currency, amount_paid) values (608,'PaidAtBirth',$1,$2,100,200,'EGP',100)", [today, addDays(today, 2)]));
    expect(ins.ok).toBe(false);
    // الدالة الذرية شغّالة
    expect((await db.tx("st1", (c) => c.query("select record_booking_payment($1, 80, 'كاش', '{}'::jsonb, null, 'تحصيل') r", [id]))).ok).toBe(true);
    expect(await paid()).toBe(80);
    // تعديل عادي على الحجز (بدون تغيير المدفوع) شغّال
    expect((await db.tx("res1", (c) => c.query("update bookings set notes = 'ملاحظة' where id = $1", [id]))).ok).toBe(true);
    // ديون الكافيتيريا
    const r2 = await db.tx("st1", (c) => c.query("select record_staff_cafeteria('Omar', null, 'tea', 30, 'EGP') r"));
    expect(r2.ok, String(r2.err?.message)).toBe(true);
    for (const u of ["st1", "st2", "gm1", "acc1"]) {
      await db.tx(u, (c) => c.query("update staff_cafeteria set paid_amount = amount, payments = '[{\"fake\":1}]'::jsonb where consumer_name = 'Omar'"));
      await db.tx(u, (c) => c.query("update staff_cafeteria set amount = 1 where consumer_name = 'Omar'"));
      expect((await db.q("select paid_amount::float p, amount::float a from staff_cafeteria where consumer_name = 'Omar'"))[0], u).toEqual({ p: 0, a: 30 });
    }
    expect((await db.tx("st1", (c) => c.query("insert into staff_cafeteria(consumer_name, amount, paid_amount, payments) values ('X', 50, 50, '[{\"x\":1}]'::jsonb)"))).ok).toBe(false);
    expect((await db.tx("st2", (c) => c.query("select settle_staff_cafeteria('Omar', null, 'EGP', 10, 'كاش', '{}'::jsonb) r"))).ok).toBe(false);   // st2 مفيش شيفتها مفتوح - بس الدالة هي الطريق الوحيد
    // الصيانة (محرر SQL: من غير مستخدم) لسه تقدر تصحّح
    await db.q("update bookings set amount_paid = 90 where id = $1", [id]);
    expect(await paid()).toBe(90);
    await db.q("delete from shift_records"); await db.q("delete from shift_claims");
  });

  it("موظف بيستلم الشيفت اللي بعده: يقدر يقفل شيفت زميله بس، مايمسحش صفوفه ولا يغيّر اسم صاحبه، وصاحب الشيفت مايغيّرش اسمه", async () => {
    const rows = [{ ...emptyRow(601), collectionAmt: 500, collectionMethod: "كاش", collectionCurrency: "EGP", collectionDesc: "x" }];
    await db.q("insert into shift_claims(date, shift_key, username, name) values ($1,'morning','st1','st1'), ($1,'evening','st2','st2') on conflict do nothing", [today]);
    await db.q("insert into shift_records(date, shift_key, staff_name, staff_username, rows) values ($1,'morning','st1','st1',$2::jsonb)", [today, JSON.stringify(rows)]);
    const sum = async () => Number((await db.q("select coalesce(sum((x ->> 'collectionAmt')::numeric),0)::float s from shift_records, jsonb_array_elements(rows) x where shift_key = 'morning'"))[0].s);
    // st2 (الشيفت اللي بعده) يحاول يمسح تحصيل st1 / يغيّر اسمه
    expect((await db.tx("st2", (c) => c.query("update shift_records set rows = '[]'::jsonb where shift_key = 'morning'"))).ok).toBe(false);
    expect((await db.tx("st2", (c) => c.query("update shift_records set rows = '[]'::jsonb, closed = true where shift_key = 'morning'"))).ok).toBe(false);
    expect((await db.tx("st2", (c) => c.query("update shift_records set staff_name = 'Boss' where shift_key = 'morning'"))).ok).toBe(false);
    expect((await db.tx("st2", (c) => c.query("update shift_records set shift_notes = 'x' where shift_key = 'morning'"))).ok).toBe(false);
    expect(await sum()).toBe(500);
    // الإقفال بس (زي الإقفال التلقائي لما موظف جديد يبدأ) مسموح
    const close = await db.tx("st2", (c) => c.query("update shift_records set closed = true, closed_by = 'st1 (إقفال تلقائي - st2 بدأ الشيفت التالي)', closed_at = now(), closing_cash = '{\"EGP\":500}'::jsonb where shift_key = 'morning'"));
    expect(close.ok, String(close.err?.message)).toBe(true);
    expect(await sum()).toBe(500);
    // صاحب الشيفت (قبل الإقفال) مايغيّرش اسمه
    expect((await db.tx("gm1", (c) => c.query("update shift_records set closed = false where shift_key = 'morning'"))).ok).toBe(true);   // المدير العام يعيد الفتح
    expect((await db.tx("st1", (c) => c.query("update shift_records set staff_name = 'Manager Ahmed' where shift_key = 'morning'"))).ok).toBe(false);
    expect((await db.tx("st1", (c) => c.query("update shift_records set shift_notes = 'ملاحظتي' where shift_key = 'morning'"))).ok).toBe(true);
    await db.q("delete from shift_records"); await db.q("delete from shift_claims");
  });

  it("calma_schema_version: متاحة للمسجّلين بس (مش anon) وبترجّع الرقم اللي الواجهة محتاجاه", async () => {
    const ok = await db.tx("st1", (c) => c.query("select calma_schema_version() v"));
    expect(ok.ok).toBe(true);
    expect(Number(ok.r.rows[0].v)).toBeGreaterThanOrEqual(36);
    const c = await db.pool.connect();
    try {
      await c.query("begin"); await c.query("set local role anon");
      await expect(c.query("select calma_schema_version()")).rejects.toThrow();
    } finally { await c.query("rollback").catch(() => {}); c.release(); }
  });

  it("calma_num بيقرا .5 و 1e3 و 5. زي المتصفح (كانت صفر فبيتمسح تحصيل موجود)", async () => {
    const r = await db.q("select calma_num('.5')::float a, calma_num('1e3')::float b, calma_num('5.')::float c, calma_num('-2.50')::float d, calma_num('abc')::float e, calma_num('')::float f, calma_num(null)::float g");
    expect(r[0]).toEqual({ a: 0.5, b: 1000, c: 5, d: -2.5, e: 0, f: 0, g: 0 });
  });

  it("تحصيل جديد على صف اليومية اللي مكتوب فيه المبلغ بصيغة 1e3: المبلغ القديم مابيضيعش", async () => {
    await db.q("insert into shift_claims(date, shift_key, username, name) values ($1,'morning','st1','st1') on conflict do nothing", [today]);
    const id = (await db.q("insert into bookings(room, guest_name, checkin, checkout, price_night, total_room, currency) values (604,'Sci',$1,$2,1000,2000,'EGP') returning id", [today, addDays(today, 2)]))[0].id;
    const row = { ...emptyRow(604), bookingId: id, collectionDesc: "تحصيل قديم", collectionAmt: "1e3", collectionMethod: "كاش", collectionCurrency: "EGP" };
    await db.q("insert into shift_records(date, shift_key, staff_name, staff_username, rows) values ($1,'morning','st1','st1',$2::jsonb)", [today, JSON.stringify([row])]);
    await db.q("update bookings set amount_paid = 1000 where id = $1", [id]);
    const p = await db.tx("st1", (c) => c.query("select record_booking_payment($1, 500, 'كاش', '{}'::jsonb, null, 'تحصيل') r", [id]));
    expect(p.ok, String(p.err?.message)).toBe(true);
    const [rec] = await db.q("select rows from shift_records where shift_key='morning'");
    expect(rec.rows.filter((r) => r.bookingId === id).reduce((a, r) => a + Number(r.collectionAmt), 0)).toBe(1500);
    await db.q("delete from shift_records"); await db.q("delete from shift_claims");
  });
});
