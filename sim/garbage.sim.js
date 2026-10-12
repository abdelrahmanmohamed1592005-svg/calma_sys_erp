/*
  مدخلات غلط/خبيثة على قاعدة حقيقية بهوية موظف: أرقام سالبة/ضخمة، عملات وحالات وجهات غريبة، تواريخ معكوسة، JSON بشكل غلط أو
  ضخم، نصوص طويلة جدًا، أكواد أفراد كتيرة. كلها لازم تتقفل في القاعدة نفسها (مش بس في الواجهة). والنصوص الغريبة
  (علامات اقتباس، SQL، HTML) بتتخزن زي ما هي من غير ما تكسر حاجة.
*/
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { enabled, buildTemplate, dropTemplate, newDb } from "./helpers.js";

describe.skipIf(!enabled)("مدخلات غلط", () => {
  let db, today;
  beforeAll(async () => { await buildTemplate(); db = await newDb(); [{ today }] = await db.q("select hotel_today()::text today"); });
  afterAll(async () => { await db?.close(); await dropTemplate(); });

  const base = () => ({ room: 601, guest_name: "G", checkin: today, checkout: null, price_night: 100, total_room: 100, currency: "USD", source: "مباشر", status: "مؤكد", pax: 1, amount_paid: 0 });
  const insert = (over, user = "st1") => {
    const row = { ...base(), ...over };
    row.checkout = row.checkout ?? `(${JSON.stringify(row.checkin)}::date + 1)`;
    const cols = Object.keys(row).filter((k) => k !== "checkout"); 
    const params = cols.map((k) => (typeof row[k] === "object" && row[k] !== null ? JSON.stringify(row[k]) : row[k]));
    return db.tx(user, (c) => c.query(`insert into bookings(${[...cols, "checkout"].join(",")}) values (${cols.map((_, i) => `$${i + 1}${typeof row[cols[i]] === "object" && row[cols[i]] !== null ? "::jsonb" : ""}`).join(",")}, ${over.checkout ? `$${cols.length + 1}` : `$1::date + 1`}) returning id`.replace("$1::date + 1", `${"$" + (cols.indexOf("checkin") + 1)}::date + 1`), over.checkout ? [...params, over.checkout] : params));
  };

  const bad = {
    "سعر ليلة سالب": { price_night: -1 }, "إجمالي غرفة سالب": { total_room: -5 }, "مدفوع سالب": { amount_paid: -1 },
    "مدفوع ضخم": { amount_paid: 1e12 }, "سعر ضخم": { price_night: 1e12 }, "أفراد صفر": { pax: 0 }, "أفراد كتير": { pax: 101 },
    "عملة غريبة": { currency: "XYZ" }, "عملة فاضية": { currency: "" }, "جهة حجز غريبة": { source: "Airbnb" }, "حالة غريبة": { status: "weird" },
    "اسم نزيل طويل جدًا": { guest_name: "x".repeat(201) }, "ملاحظات طويلة": { notes: "n".repeat(2001) }, "تليفون طويل": { phone: "9".repeat(61) },
    "رسوم سالبة": { extras: { laundry: -1, cafeteria: 0, tours: 0, pickup: 0 } }, "رسوم كبيرة جدًا JSON": { extras: { laundry: 0, cafeteria: 0, tours: 0, pickup: 0, junk: "j".repeat(2100) } },
    "تفاصيل دفع ضخمة": { payment_details: { senderName: "s".repeat(4100), senderNumber: "", ref: "", onlinePaid: false } },
    "دخول مبكر برسم سالب": { early_checkin: { applied: true, fee: -5, note: "" } },
    "أكواد أفراد مش مصفوفة": { guest_codes: { a: 1 } }, "أكواد أفراد ١٠١": { guest_codes: Array.from({ length: 101 }, (_, i) => `c${i}`) },
    "غرفة مش موجودة": { room: 99999 }, "خروج قبل الدخول": { checkout: "2000-01-01" },
    "كود فرد طويل": { guest_codes: ["z".repeat(41)] }, "كود مكرر في نفس الحجز": { guest_codes: ["A", "a"], pax: 2 },
  };
  for (const [label, over] of Object.entries(bad)) {
    it(`مرفوض: ${label}`, async () => {
      const r = await insert(over);
      expect(r.ok, `اتقبل غلط: ${label}`).toBe(false);
      expect(await db.q("select 1 from bookings")).toHaveLength(0);       // ومفيش حاجة اتحفظت جزئيًا
    });
  }

  it("نصوص غريبة (علامات اقتباس، SQL، HTML، رموز تحكم، إيموجي) بتتخزن زي ما هي من غير ما تكسر أو تتنفّذ", async () => {
    const nasty = ["O'Brien", `"; drop table bookings; --`, "<script>alert(1)</script>", "نزيل ١٢٣ 😀", "line1\nline2", "back\\slash", "%_like"];
    for (const [i, g] of nasty.entries()) {
      const r = await insert({ room: 601 + (i % 5), guest_name: g, checkin: `2031-0${(i % 9) + 1}-10` });
      expect(r.ok, `${g}: ${r.err?.message}`).toBe(true);
    }
    const rows = await db.q("select guest_name from bookings order by created_at");
    expect(rows.map((x) => x.guest_name)).toEqual(nasty);
    expect((await db.q("select count(*)::int n from bookings"))[0].n).toBe(nasty.length);
  });

  it("الموظف مايقدرش يلعب في الحقول المحمية عند الإضافة (إلغاء مباشر، موافقة، رد فلوس)", async () => {
    expect((await insert({ status: "ملغي" })).ok).toBe(false);
    const r = await db.tx("st1", (c) => c.query("insert into bookings(room, guest_name, checkin, checkout, price_night, total_room, refund_pending, refunded_amount, refund_decision, approval_status) values (603, 'p', $1::date + 70, $1::date + 71, 1, 1, true, 999, 'refunded', 'approved') returning refund_pending, refunded_amount, refund_decision", [today]));
    expect(r.ok).toBe(true);
    expect(r.r.rows[0]).toEqual({ refund_pending: false, refunded_amount: null, refund_decision: null });   // اتصفّروا في القاعدة
  });
});
