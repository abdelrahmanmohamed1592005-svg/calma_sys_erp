/*
  اختبار عشوائي بسلسلة ثابتة (seed): عمليات مختلطة من الواجهة بجلستين (موظف + مدير حجوزات)
  على غرف قليلة عشان التعارضات تحصل فعلاً. بعد كل عملية بنتأكد من قواعد لازم تفضل صحيحة
  مهما كان الترتيب:
   ١) صافي التحصيل في اليومية (بالدولار) = مجموع المدفوع على كل الحجوزات
   ٢) حالة "متحصّل" معناها المدفوع غطّى الإجمالي، وطلب الرد معناه فيه فلوس زيادة فعلاً
   ٣) مفيش حجزين نشطين متداخلين على نفس الغرفة
   ٤) مفيش مدفوع سالب
  وفي الآخر التقرير ولوحة الغرف بيطابقوا القاعدة.
*/
import { test, expect } from "../fixtures";
import { login, goTab, field, boardTile, roomCard, toast, refresh, digits, cairoDate, addBooking, openRoom } from "../ui";

const mulberry32 = (a) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const ROOMS = [601, 602, 603, 604];
const grand = (b) => Number(b.total_room) + Object.values(b.extras || {}).reduce((s, v) => s + (Number(v) || 0), 0) + (b.early_checkin?.applied ? Number(b.early_checkin.fee) || 0 : 0);
const isOnline = (b) => !!b.payment_details?.onlinePaid;
// اللي الفندق نفسه بيحصّله (الأونلاين: من غير سعر الغرفة اللي اتدفع للمنصة)
const hotelTotal = (b) => (isOnline(b) ? grand(b) - Number(b.total_room) : grand(b));
const nightsBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);

async function snapshot(env) {
  const bookings = await env.q("select * from bookings order by created_at");
  const recs = await env.q("select rows from shift_records");
  const ledger = recs.reduce((s, r) => s + r.rows.reduce((a, x) => a + (x.collectionCurrency === "USD" ? Number(x.collectionAmt) || 0 : 0), 0) + 0, 0);
  return { bookings, ledger };
}
async function checkInvariants(env, label) {
  const { bookings, ledger } = await snapshot(env);
  const paidSum = bookings.reduce((s, b) => s + Number(b.amount_paid), 0);
  expect(ledger, `${label}: صافي اليومية = مجموع المدفوع`).toBeCloseTo(paidSum, 2);
  for (const b of bookings) {
    expect(Number(b.amount_paid), `${label}: مدفوع غير سالب (${b.guest_name})`).toBeGreaterThanOrEqual(0);
    if (b.settled && !isOnline(b)) expect(Number(b.amount_paid), `${label}: متحصّل لازم يكون مغطّى (${b.guest_name})`).toBeGreaterThanOrEqual(grand(b) - 0.005);
    if (b.refund_pending) {
      const due = b.status === "ملغي" ? Number(b.amount_paid) : Number(b.amount_paid) - grand(b);
      expect(due, `${label}: طلب رد لازم يبقى فيه فلوس (${b.guest_name})`).toBeGreaterThan(0);
    }
  }
  const active = bookings.filter((b) => b.status !== "ملغي" && b.checkout > b.checkin);
  for (const r of ROOMS) {
    const rs = active.filter((b) => b.room === r).sort((a, b) => (a.checkin < b.checkin ? -1 : 1));
    for (let i = 1; i < rs.length; i++) expect(rs[i].checkin >= rs[i - 1].checkout, `${label}: تداخل على غرفة ${r}`).toBe(true);
  }
}

for (const seed of [11, 2024, 77, 5, 313, 9001]) {
  test(`سلسلة عمليات عشوائية (seed ${seed}) من جلستين: القواعد بتفضل صحيحة بعد كل عملية`, async ({ page: staff, env }) => {
    test.setTimeout(420000);
    await env.seedUser("ahmed", "staff", "أحمد");
    await env.seedUser("rawan", "reservations", "روان");
    await env.seedUser("boss", "gm", "المدير");
    await env.seedShift("ahmed");
    const rnd = mulberry32(seed);
    const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
    const res = await env.newSession();
    await staff.goto("/"); await login(staff, "ahmed");
    await res.goto("/"); await login(res, "rawan");
    const today = cairoDate(0);
    let n = 0;
    const log = [];
    const overlaps = (list, room, ci, co, exceptId) => list.some((b) => b.id !== exceptId && b.room === room && b.status !== "ملغي" && b.checkout > b.checkin && !(co <= b.checkin || ci >= b.checkout));
    const sync = async () => { await refresh(staff); await refresh(res); };

    const ops = {
      async add() {
        const { bookings } = await snapshot(env);
        const room = pick(ROOMS), start = pick([0, 0, 1, 2]), nights = pick([1, 2, 3]);
        const total = 50 * nights;
        const paid = pick([0, 0, 50, total]);
        const guest = `G${++n}`;
        const conflict = overlaps(bookings, room, cairoDate(start), cairoDate(start + nights));
        log.push(`add ${guest} r${room} +${start}x${nights} paid ${Math.min(paid, total)}${conflict ? " (conflict)" : ""}`);
        await addBooking(staff, { room, guest, price: 50, nights, startOffset: start, paid: Math.min(paid, total) || undefined, expectSaved: false });
        // التعارض: لو القديم دخل فعلاً بيتسجّل خروجه المبكر والجديد بيتسكّن، وغير كده (مزدوج حقيقي) مرفوض بسبب واضح
        await expect(toast(staff)).toContainText(conflict ? /تم الحفظ|لسه ماجاش معاده|نزيله لسه في الغرفة|قبل دخول/ : "تم الحفظ");
        if (await staff.locator(".cx-card[data-calma-editing]").count()) await staff.getByRole("button", { name: "إلغاء", exact: true }).click();
      },
      async collect() {
        const { bookings } = await snapshot(env);
        const c = bookings.filter((b) => b.status !== "ملغي" && b.checkin <= today && today < b.checkout && hotelTotal(b) > Number(b.amount_paid) + 0.005);
        if (!c.length) return false;
        const b = pick(c);
        log.push(`collect ${b.guest_name}`);
        await goTab(staff, "لوحة الغرف"); await openRoom(staff, b.room);
        await expect(roomCard(staff)).toContainText(b.guest_name);
        if (isOnline(b)) {
          await roomCard(staff).getByTestId("collect-extras").click();
          await expect(toast(staff)).toContainText("تم تسجيل تحصيل الخدمات");
        } else {
          await roomCard(staff).getByRole("button", { name: /تسجيل تحصيل كامل المبلغ/ }).click();
          await expect(toast(staff)).toContainText("تم تسجيل التحصيل الكامل");
        }
      },
      async earlyCheckin() {
        const { bookings } = await snapshot(env);
        const c = bookings.filter((b) => b.status !== "ملغي" && b.checkin <= today && today < b.checkout && !b.early_checkin?.applied);
        if (!c.length) return false;
        const b = pick(c);
        const fee = pick([20, 40]), now = rnd() < 0.6;
        log.push(`early ${b.guest_name} ${fee} ${now ? "collect" : "later"}`);
        await goTab(staff, "لوحة الغرف"); await openRoom(staff, b.room);
        await expect(roomCard(staff)).toContainText(b.guest_name);
        await staff.getByTestId("early-fee").fill(String(fee));
        if (!now) await staff.getByTestId("early-collect").uncheck();
        await staff.getByTestId("early-apply").click();
        await expect(toast(staff)).toContainText("تم تسجيل الدخول المبكر");
      },
      async earlyLeave() {
        const { bookings } = await snapshot(env);
        const c = bookings.filter((b) => b.status !== "ملغي" && b.checkin <= today && today < b.checkout);
        if (!c.length) return false;
        const b = pick(c);
        log.push(`leave ${b.guest_name}`);
        await goTab(staff, "لوحة الغرف"); await openRoom(staff, b.room);
        await expect(roomCard(staff)).toContainText(b.guest_name);
        await roomCard(staff).getByTestId("early-leave").getByRole("button", { name: /غادر مبكرًا/ }).click();
        await roomCard(staff).getByRole("button", { name: "تأكيد المغادرة المبكرة؟" }).click();
        await expect(toast(staff)).toContainText("النزيل غادر مبكرًا");
      },
      async addOnline() {
        const { bookings } = await snapshot(env);
        const room = pick(ROOMS), nights = pick([1, 2]);
        if (overlaps(bookings, room, cairoDate(0), cairoDate(nights))) return false;
        const guest = `O${++n}`;
        log.push(`online ${guest} r${room}`);
        await env.seedBooking({ room, guest, start: 0, nights, price: 60, payment_details: { senderName: "", senderNumber: "", ref: "BK", onlinePaid: true } });
      },
      async extend() {
        const { bookings } = await snapshot(env);
        const c = bookings.filter((b) => b.status !== "ملغي" && b.checkin <= today && today < b.checkout);
        if (!c.length) return false;
        const b = pick(c);
        const blocked = overlaps(bookings, b.room, b.checkout, cairoDate(nightsBetween(today, b.checkout) + 1), b.id);
        log.push(`extend ${b.guest_name}${blocked ? " (blocked)" : ""}`);
        await goTab(staff, "لوحة الغرف"); await openRoom(staff, b.room);
        await expect(roomCard(staff)).toContainText(b.guest_name);
        await roomCard(staff).getByRole("button", { name: /تمديد الحجز/ }).click();
        await expect(toast(staff)).toContainText(blocked ? /محجوزة لحد تاني|مدير الحجوزات ضايف/ : "تم تمديد الحجز");
      },
      async cancel() {
        const { bookings } = await snapshot(env);
        const c = bookings.filter((b) => b.status !== "ملغي");
        if (!c.length) return false;
        const b = pick(c);
        log.push(`cancel ${b.guest_name} paid ${b.amount_paid}`);
        await goTab(res, "الحجوزات");
        await res.getByTestId("status-filter-all").click();
        const c0 = res.locator(".cx-card", { hasText: b.guest_name }).last();
        await c0.getByRole("button", { name: "إلغاء الحجز" }).click();
        await c0.getByRole("button", { name: "تأكيد الإلغاء؟" }).click();
        await expect(toast(res)).toContainText("تم إلغاء الحجز");
      },
      async decide() {
        const { bookings } = await snapshot(env);
        const c = bookings.filter((b) => b.refund_pending);
        if (!c.length) return false;
        const b = pick(c);
        const refund = rnd() < 0.6;
        log.push(`${refund ? "refund" : "keep"} ${b.guest_name}`);
        await goTab(res, "الحجوزات");
        const req = res.locator(".cx-card", { hasText: b.guest_name }).last().getByTestId("refund-request");
        await req.getByRole("button", { name: refund ? "رد الفلوس" : /رفض الرد/ }).click();
        await expect(toast(res)).toContainText(refund ? "تم رد" : "تم رفض الرد");
      },
      async shorten() {
        const { bookings } = await snapshot(env);
        const c = bookings.filter((b) => b.status !== "ملغي" && nightsBetween(b.checkin, b.checkout) >= 2);
        if (!c.length) return false;
        const b = pick(c);
        const newCo = cairoDate(nightsBetween(today, b.checkin) + pick(Array.from({ length: nightsBetween(b.checkin, b.checkout) - 1 }, (_, i) => i + 1)));
        log.push(`shorten ${b.guest_name} -> ${newCo}`);
        await goTab(res, "الحجوزات");
        await res.locator(".cx-card", { hasText: b.guest_name }).last().locator("button").first().click();
        await field(res, "تاريخ الخروج").fill(newCo);
        await res.getByRole("button", { name: /حفظ الحجز/ }).click();
        await expect(res.locator(".cx-card[data-calma-editing]")).toHaveCount(0);
      },
    };

    // البداية: كام حجز عشان العمليات تلاقي حاجة تشتغل عليها
    for (let i = 0; i < 3; i++) { await ops.add(); await sync(); await checkInvariants(env, `بداية ${i}`); }
    const weights = [["add", 3], ["collect", 3], ["extend", 2], ["cancel", 1], ["decide", 3], ["shorten", 2], ["earlyCheckin", 2], ["earlyLeave", 2], ["addOnline", 1]];
    const bag = weights.flatMap(([k, w]) => Array(w).fill(k));
    for (let step = 0; step < 20; step++) {
      const op = pick(bag);
      const r = await ops[op]();
      await sync();
      await checkInvariants(env, `خطوة ${step + 1} (${log[log.length - 1] || op})`);
      if (r === false) log.push(`skip ${op}`);
    }

    // ---- النهاية: التقرير ولوحة الغرف بيطابقوا قاعدة البيانات ----
    const { bookings, ledger } = await snapshot(env);
    await goTab(res, "التقارير");
    const card = res.locator(".cx-report-grid .cx-card", { hasText: "إجمالي التحصيل" }).first();
    const shown = digits(await card.innerText()).replace("إجماليالتحصيل", "");
    expect(shown, `التقرير (${log.join(" | ")})`).toBe(ledger === 0 ? "0" : `${ledger}$`);
    await goTab(res, "لوحة الغرف");
    const live = bookings.filter((b) => b.status !== "ملغي" && b.checkin <= today && today < b.checkout);
    const rooms = new Set(live.map((b) => b.room));
    const unpaid = [...rooms].filter((r) => { const b = live.find((x) => x.room === r); return !(Number(b.amount_paid) >= hotelTotal(b) - 0.005); }).length;
    await expect(res.getByText(new RegExp(`مشغولة - متبقي فلوس ${unpaid}\\b`))).toBeVisible();
    await expect(res.getByText(new RegExp(`مشغولة - متحصّلة ${rooms.size - unpaid}\\b`))).toBeVisible();
    // غرف اتعلّمت "غادر مبكرًا" النهارده (من زرار المغادرة المبكرة) ومفيش عليها نزيل نشط دلوقتي
    const ovRooms = new Set((await env.q("select room_number from room_overrides where status = 'early_checkout'")).map((o) => o.room_number).filter((r) => !rooms.has(r)));
    const soon = new Set(bookings.filter((b) => b.status !== "ملغي" && b.checkin > today && b.checkin <= cairoDate(2) && !rooms.has(b.room) && !ovRooms.has(b.room)).map((b) => b.room));
    await expect(res.getByText(new RegExp(`قادمة قريبًا ${soon.size}\\b`))).toBeVisible();
    await expect(res.getByText(new RegExp(`غادر مبكرًا ${ovRooms.size}\\b`))).toBeVisible();
    await expect(res.getByText(new RegExp(`متاحة ${16 - rooms.size - soon.size - ovRooms.size}\\b`)).first()).toBeVisible();
  });
}
