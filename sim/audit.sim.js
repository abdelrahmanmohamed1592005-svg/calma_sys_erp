/* سجل التدقيق على مستوى القاعدة (money_audit): بيتسجّل مهما كان الطريق، ومينفعش يتعدّل ولا يتمسح ولا يتقرا من موظف. */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { enabled, buildTemplate, dropTemplate, newDb } from "./helpers.js";

describe.skipIf(!enabled)("سجل التدقيق", () => {
  beforeAll(async () => { await buildTemplate(); });
  afterAll(async () => { await dropTemplate(); });

  it("دفعة ورد وتغيير دور وإعادة فتح يومية: كلها بتسيب أثر بهوية المنفّذ، والموظف مايقراش ولا يعدّل", async () => {
    const db = await newDb();
    try {
      const [{ today }] = await db.q("select hotel_today()::text today");
      await db.q("insert into shift_claims(date, shift_key, username, name) values ($1,'morning','st1','st1')", [today]);
      await db.q("insert into shift_records(date, shift_key, staff_name, staff_username) values ($1,'morning','st1','st1')", [today]);
      const [{ id }] = await db.q("insert into bookings(room, guest_name, checkin, checkout, price_night, total_room, currency) values (601,'Audit Guest',$1::date + 1,$1::date + 2,100,100,'USD') returning id", [today]);
      const pay = await db.tx("st1", (c) => c.query("select record_booking_payment($1, 100, 'كاش', '{}'::jsonb, null, null)", [id]));
      expect(pay.ok, pay.err?.message).toBe(true);
      expect((await db.tx("res1", (c) => c.query("update bookings set status='ملغي' where id=$1", [id]))).ok).toBe(true);
      expect((await db.tx("res1", (c) => c.query("select move_booking_room($1, 602)", [id]))).ok).toBe(false);   // الملغي مايتنقلش
      expect((await db.tx("gm1", (c) => c.query("update profiles set role='accounts' where username='st2'"))).ok).toBe(true);

      const rows = await db.q("select actor, tbl, action, old_val, new_val from money_audit order by id");
      const bk = rows.filter((r) => r.tbl === "bookings");
      expect(bk.some((r) => r.actor === "st1" && r.old_val.amount_paid === 0 && r.new_val.amount_paid === 100)).toBe(true);     // الدفع بهوية الموظف
      expect(bk.some((r) => r.actor === "res1" && r.new_val.status === "ملغي")).toBe(true);
      expect(bk.some((r) => r.new_val.amount_paid === 0 && r.old_val.amount_paid === 100)).toBe(false);                         // مفيش رد فلوس
      expect(rows.some((r) => r.tbl === "profiles" && r.actor === "gm1" && r.old_val.role === "staff" && r.new_val.role === "accounts")).toBe(true);

      // تعديل من غير هوية (محرر SQL) لسه بيتسجّل، من غير اسم منفّذ
      await db.q("update bookings set amount_paid = 0 where id=$1", [id]);   // نفس القيمة: مفيش أثر
      const before = (await db.q("select count(*)::int n from money_audit"))[0].n;
      await db.q("update bookings set price_night = 120 where id=$1", [id]);
      expect((await db.q("select count(*)::int n from money_audit"))[0].n).toBe(before + 1);

      // الموظف: قراءة/تعديل/مسح مرفوضين
      const sel = await db.tx("st1", (c) => c.query("select count(*)::int n from money_audit"));
      expect(!sel.ok || sel.r.rows[0].n === 0).toBe(true);
      for (const sql of ["delete from money_audit", "update money_audit set actor='x'", "insert into money_audit(tbl, action) values ('bookings','update')"]) {
        const r = await db.tx("st1", (c) => c.query(sql)); expect(r.ok, sql).toBe(false);
        const r2 = await db.tx("res1", (c) => c.query(sql)); expect(r2.ok, sql + " res").toBe(false);
        const r3 = await db.tx("gm1", (c) => c.query(sql)); expect(r3.ok, sql + " gm").toBe(false);
      }
      expect((await db.tx("gm1", (c) => c.query("select count(*)::int n from money_audit"))).r.rows[0].n).toBeGreaterThan(3);
    } finally { await db.close(); }
  });
});

describe.skipIf(!enabled)("سحب الصلاحيات", () => {
  beforeAll(async () => { await buildTemplate(); });
  afterAll(async () => { await dropTemplate(); });

  it("تغيير دور أو إيقاف حساب بيسري على طلب الـ API الجاي فورًا (حتى بنفس الجلسة/التوكن)", async () => {
    const db = await newDb();
    try {
      const [{ today }] = await db.q("select hotel_today()::text today");
      await db.q("insert into shift_claims(date, shift_key, username, name) values ($1,'morning','st1','st1')", [today]);
      await db.q("insert into shift_records(date, shift_key, staff_name, staff_username) values ($1,'morning','st1','st1')", [today]);
      const mk = async () => (await db.q("insert into bookings(room, guest_name, checkin, checkout, price_night, total_room, currency) values (601 + (random()*10)::int,'Rv',$1::date + 20 + (random()*1000)::int,$1::date + 1030,100,100,'USD') returning id", [today]))[0].id;
      const id1 = await mk();
      expect((await db.tx("st1", (c) => c.query("select record_booking_payment($1, 10, 'كاش', '{}'::jsonb, null, null)", [id1]))).ok).toBe(true);
      // المدير العام يوقف الموظف: أول طلب بعدها يترفض (التوكن لسه صالح بس الصلاحية بتتقرا من القاعدة كل مرة)
      expect((await db.tx("gm1", (c) => c.query("update profiles set active=false where username='st1'"))).ok).toBe(true);
      const after = await db.tx("st1", (c) => c.query("select record_booking_payment($1, 10, 'كاش', '{}'::jsonb, null, null)", [id1]));
      expect(after.ok).toBe(false);
      expect((await db.tx("st1", (c) => c.query("select count(*)::int from bookings"))).r?.rows?.[0]?.count ?? 0).toBe(0);   // ولا قراءة
      // إعادة تفعيل ثم تغيير الدور لمدير حجوزات: دالة الدفع تتقفل
      await db.q("update profiles set active=true where username='st1'");
      await db.tx("gm1", (c) => c.query("update profiles set role='reservations' where username='st1'"));
      const asRes = await db.tx("st1", (c) => c.query("select record_booking_payment($1, 10, 'كاش', '{}'::jsonb, null, null)", [id1]));
      expect(asRes.ok).toBe(false);
      expect(String(asRes.err?.message)).toContain("موظف الشيفت");
      // الموظف مايقدرش يرفع دور نفسه، ولا يوقف حد، ولا آخر مدير عام يتقفل
      const self = await db.tx("st2", (c) => c.query("update profiles set role='gm' where username='st2'"));
      expect(self.ok === false || self.r.rowCount === 0).toBe(true);
      expect((await db.q("select role from profiles where username='st2'"))[0].role).toBe("staff");
      const lastGm = await db.tx("gm1", (c) => c.query("update profiles set active=false where username='gm1'"));
      expect(lastGm.ok).toBe(false);
    } finally { await db.close(); }
  });
});
