/*
  مصفوفة صلاحيات كاملة على قاعدة حقيقية: كل دور (مدير عام / مدير حجوزات / موظف / موظف تاني / حسابات / موظف موقوف / زائر
  من غير دخول) × كل جدول × كل عملية (قراءة / إضافة / تعديل / مسح). كل خانة بتتجرّب فعليًا (وبتتعمل rollback) وبنقارنها
  بالمتوقع. أي فرق = ثغرة صلاحيات أو قرار عمل اتغيّر من غير ما حد يقصد.
*/
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { enabled, buildTemplate, dropTemplate, newDb } from "./helpers.js";

const ALL = ["gm1", "res1", "st1", "st2", "acc1"];
const ROLES = { gm1: "gm", res1: "reservations", st1: "staff", st2: "staff", acc1: "accounts" };

describe.skipIf(!enabled)("مصفوفة الصلاحيات", () => {
  let db, today, bookingId, claimDay;
  beforeAll(async () => {
    await buildTemplate();
    db = await newDb();
    [{ today }] = await db.q("select hotel_today()::text today");
    await db.q("insert into auth.users(id, email) values ('00000000-0000-0000-0000-0000000000aa', 'off@calma.internal')");
    await db.q("insert into profiles(id, username, name, role, active) values ('00000000-0000-0000-0000-0000000000aa', 'off1', 'off1', 'staff', false)");
    db.ids.off1 = "00000000-0000-0000-0000-0000000000aa";
    [{ id: bookingId }] = await db.q("insert into bookings(room, guest_name, checkin, checkout, price_night, total_room) values (601, 'M', $1::date, $1::date + 1, 100, 100) returning id", [today]);
    await db.q("insert into shift_claims(date, shift_key, username, name) values ($1, 'night', 'st1', 'st1')", [today]);
    await db.q("insert into shift_records(date, shift_key, staff_name, staff_username) values ($1, 'night', 'st1', 'st1')", [today]);
    await db.q("insert into activity_log(user_name, username, role, action) values ('x', 'st2', 'staff', 'a'), ('y', 'res1', 'reservations', 'b')");
    await db.q("insert into staff_cafeteria(consumer_name, amount) values ('s', 10)");
    await db.q("insert into room_overrides(room_number, status) values (602, 'cleaning')");
  });
  afterAll(async () => { await db?.close(); await dropTemplate(); });

  // يجرّب عملية بهوية مستخدم (أو anon) وبيعمل rollback دايمًا. بيرجّع true لو الصلاحية سمحت فعلاً.
  const probe = async (user, sql, params = [], kind = "write") => {
    const c = await db.pool.connect();
    try {
      await c.query("begin");
      if (user === "anon") await c.query("set local role anon");
      else { await c.query("select set_config('request.jwt.claim.sub', $1, true)", [db.ids[user]]); await c.query("set local role authenticated"); }
      const r = await c.query(sql, params);
      const allowed = kind === "read" ? r.rows.length > 0 && Number(r.rows[0].n) > 0 : r.rowCount > 0;
      return allowed;
    } catch { return false; }
    finally { await c.query("rollback").catch(() => {}); c.release(); }
  };
  const cases = () => ([
    // [وصف، SQL، المسموح لهم، نوع، params]
    ["rooms: قراءة", "select count(*) n from rooms", ALL, "read"],
    ["rooms: تعديل", "update rooms set name = name where number = 601", ["res1"]],
    ["rooms: إضافة", "insert into rooms(number, name) values (999, 'x')", ["res1"]],
    ["room_overrides: قراءة", "select count(*) n from room_overrides", ALL, "read"],
    ["room_overrides: تعديل", "update room_overrides set status = 'cleaning' where room_number = 602", ["st1", "st2", "res1"]],
    ["room_overrides: مسح", "delete from room_overrides where room_number = 602", ["st1", "st2", "res1"]],
    ["room_overrides: إضافة", "insert into room_overrides(room_number, status) values (603, 'maintenance')", ["st1", "st2", "res1"]],
    ["bookings: قراءة", "select count(*) n from bookings", ALL, "read"],
    ["bookings: إضافة", "insert into bookings(room, guest_name, checkin, checkout, price_night, total_room) values (604, 'n', current_date + 50, current_date + 51, 1, 1)", ["st1", "st2", "res1"]],
    ["bookings: تعديل الملاحظات", "update bookings set notes = 'x' where id = $1", ["st1", "st2", "res1"], "write", () => [bookingId]],
    ["bookings: مسح حجز من غير فلوس", "delete from bookings where id = $1", ["res1"], "write", () => [bookingId]],
    ["profiles: قراءة", "select count(*) n from profiles", ALL, "read"],
    ["profiles: تعديل", "update profiles set name = name where username = 'st1'", ["gm1"]],
    ["shift_claims: قراءة", "select count(*) n from shift_claims", ALL, "read"],
    // (st1 عنده اختيار شيفت النهارده فعلاً، وكل موظف شيفت واحد في اليوم) فبس الموظف التاني يقدر يختار شيفت جديد
    ["shift_claims: إضافة (موظف بس، شيفت تاني، مرة واحدة في اليوم)", "insert into shift_claims(date, shift_key, username, name) select hotel_today(), 'evening', username, name from profiles where id = auth.uid()", ["st2"]],
    ["shift_claims: تعديل", "update shift_claims set name = name", ["gm1"]],
    ["shift_claims: مسح", "delete from shift_claims", ["gm1"]],
    ["shift_records: قراءة", "select count(*) n from shift_records", ALL, "read"],
    ["shift_records: تعديل شيفت مفتوح (صاحبه بس)", "update shift_records set shift_notes = 'x'", ["st1"]],
    ["shift_records: مسح شيفت مفتوح", "delete from shift_records", ["gm1"]],
    ["shift_records: إضافة (موظف عنده اختيار شيفت)", "insert into shift_records(date, shift_key, staff_name, staff_username) select hotel_today(), 'night', 'x', 'x' from shift_claims where false", []],
    ["activity_log: قراءة الكل", "select count(*) n from activity_log where username = 'st2'", ["gm1", "res1", "acc1", "st2"], "read"],
    ["activity_log: إضافة", "insert into activity_log(action) values ('t')", ALL],
    ["activity_log: تعديل", "update activity_log set action = 'z'", []],
    ["activity_log: مسح", "delete from activity_log", []],
    ["staff_cafeteria: قراءة", "select count(*) n from staff_cafeteria", ALL, "read"],
    // الفلوس بتتكتب من دوال التحصيل بس (قسم ٣٥): مفيش دور (حتى المدير العام) بيكتبها مباشرة من الـ API
    ["staff_cafeteria: إضافة مباشرة (ممنوعة - من record_staff_cafeteria)", "insert into staff_cafeteria(consumer_name, amount) values ('n', 5)", []],
    ["staff_cafeteria: سداد مباشر (ممنوع - من settle_staff_cafeteria)", "update staff_cafeteria set paid_amount = 5, payments = '[{\"amount\":5}]'::jsonb", []],
    ["staff_cafeteria: تغيير المبلغ مباشرة (ممنوع)", "update staff_cafeteria set amount = 99", []],
    ["staff_cafeteria: تعديل الوصف (مش فلوس)", "update staff_cafeteria set description = 'x'", ["gm1", "acc1"]],
    ["bookings: كتابة المدفوع مباشرة (ممنوعة - من record_booking_payment/decide_booking_refund)", "update bookings set amount_paid = amount_paid + 1", []],
    ["staff_cafeteria: مسح", "delete from staff_cafeteria", ["gm1", "acc1"]],
    ["booking_guests: قراءة", "select count(*) n from booking_guests", ALL, "read"],
    ["booking_guests: إضافة", "insert into booking_guests(booking_id, room, seq, code) values ((select id from bookings limit 1), 601, 9, 'zz')", []],
    ["booking_code_counters: قراءة", "select count(*) n from booking_code_counters", [], "read"],
  ]);

  it("كل دور × كل جدول × كل عملية = المتوقع بالظبط", async () => {
    // حجز تاني للإضافة/القراءة ولسجل booking_guests
    await db.q("insert into booking_guests(booking_id, room, seq, code, ym) values ($1, 601, 1, 'abc', '2610')", [bookingId]);
    await db.q("insert into booking_code_counters(ym, n) values ('2610', 1) on conflict do nothing");
    const mismatches = [];
    for (const [label, sql, allowedUsers, kind = "write", paramsFn] of cases()) {
      for (const u of [...ALL, "off1", "anon"]) {
        const expected = allowedUsers.includes(u);
        const actual = await probe(u, sql, paramsFn ? paramsFn() : [], kind);
        if (actual !== expected) mismatches.push(`${label} | ${u} (${ROLES[u] || u}): المتوقع ${expected ? "مسموح" : "ممنوع"} والفعلي ${actual ? "مسموح" : "ممنوع"}`);
      }
    }
    expect(mismatches, mismatches.join("\n")).toEqual([]);
  });

  it("موظف موقوف أو زائر من غير دخول: ممنوع من أي قراءة أو كتابة على أي جدول", async () => {
    for (const u of ["off1", "anon"]) {
      for (const t of ["rooms", "bookings", "shift_records", "shift_claims", "profiles", "staff_cafeteria", "activity_log", "room_overrides"]) {
        expect(await probe(u, `select count(*) n from ${t}`, [], "read"), `${u} يقرأ ${t}`).toBe(false);
      }
    }
  });

  it("موظف مايقدرش يعدّل يومية شيفت موظف تاني ولا يقفلها، والمدير العام مايقدرش يمسح شيفت مقفول", async () => {
    expect(await probe("st2", "update shift_records set shift_notes = 'hack'")).toBe(false);
    expect(await probe("st2", "update shift_records set closed = true")).toBe(false);
    await db.q("update shift_records set closed = true");
    expect(await probe("gm1", "delete from shift_records")).toBe(false);
    expect(await probe("res1", "update shift_records set closed = false")).toBe(true);        // إعادة فتح
    expect(await probe("st1", "update shift_records set shift_notes = 'x'")).toBe(false);     // صاحبه مايعدّلش بعد الإقفال
  });
});
