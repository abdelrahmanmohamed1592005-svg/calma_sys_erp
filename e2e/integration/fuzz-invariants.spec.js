/*
  اختبار عشوائي بسلسلة ثابتة (seed): عمليات مختلطة من الواجهة بجلستين (موظف + مدير حجوزات)
  على غرف قليلة عشان التعارضات تحصل فعلاً. بعد كل عملية بنتأكد من قواعد لازم تفضل صحيحة
  مهما كان الترتيب:
   1) صافي التحصيل في اليومية (بالدولار) = مجموع المدفوع على كل الحجوزات
   2) حالة "متحصّل" معناها المدفوع غطّى الإجمالي، ومفيش طلبات رد فلوس خالص (v39)
   3) مفيش حجزين نشطين متداخلين على نفس الغرفة
   4) مفيش مدفوع سالب
  وفي الآخر التقرير ولوحة الغرف بيطابقوا القاعدة.
*/
import { test, expect } from "../fixtures";
import { login, goTab, field, boardTile, roomCard, toast, refresh, digits, cairoDate, addBooking, openRoom, payOnBoard, waitIdle, addExtraOnBoard } from "../ui";

const mulberry32 = (a) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const ROOMS = [601, 602, 603, 604];
const grand = (b) => Number(b.total_room) + Object.values(b.extras || {}).reduce((s, v) => s + (Number(v) || 0), 0) + (b.early_checkin?.applied ? Number(b.early_checkin.fee) || 0 : 0);
const isOnline = (b) => !!b.payment_details?.onlinePaid;
// اللي الفندق نفسه بيحصّله (الأونلاين: من غير سعر الغرفة اللي اتدفع للمنصة - وقت الحجز؛ التمديد بعده بيتحصّل في الفندق)
const onlineCover = (b) => Math.min(Number(b.total_room), b.payment_details?.onlineRoomAmount != null ? Number(b.payment_details.onlineRoomAmount) : Number(b.total_room));
const hotelTotal = (b) => (isOnline(b) ? grand(b) - onlineCover(b) : grand(b));
// خدمات بالجنيه على حجز بالدولار (كل عملة لوحدها من غير تحويل)
const otherTotal = (b) => ["laundry", "cafeteria", "tours", "pickup"].reduce((a, k) => a + (Number(b.other_charges?.EGP?.[k]) || 0), 0);
const otherPaid = (b) => Number(b.other_paid?.EGP) || 0;
const otherDue = (b) => Math.max(0, otherTotal(b) - otherPaid(b));
const hasDue = (b) => hotelTotal(b) > Number(b.amount_paid) + 0.005 || otherDue(b) > 0.005;
const nightsBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);

async function snapshot(env) {
  const bookings = await env.q("select * from bookings order by created_at");
  const recs = await env.q("select rows, cafeteria_rows from shift_records");
  // دفعة بعملة تانية: بتتحسب على الحجز بالمقابل بعملته (fxCovered)، واليومية/الخزينة بالعملة الفعلية
  const sumUsd = (list) => list.reduce((a, x) => a + (x.fxBookingCurrency === "USD" ? Number(x.fxCovered) || 0 : x.collectionCurrency === "USD" ? Number(x.collectionAmt) || 0 : 0), 0);
  const ledger = recs.reduce((s, r) => s + sumUsd(r.rows) + sumUsd(r.cafeteria_rows || []), 0);
  const cash = (list, cur) => list.reduce((a, x) => a + (x.collectionCurrency === cur ? Number(x.collectionAmt) || 0 : 0), 0);
  const usdCash = recs.reduce((s, r) => s + cash(r.rows, "USD") + cash(r.cafeteria_rows || [], "USD"), 0);
  const egpCash = recs.reduce((s, r) => s + cash(r.rows, "EGP") + cash(r.cafeteria_rows || [], "EGP"), 0);
  // كافيتيريا الاستاف (بالجنيه): اللي اتسدّد فعلاً لازم يساوي اللي دخل اليومية (صفوف الكافيتيريا kind=staff)
  const staffRows = await env.q("select amount, paid_amount from staff_cafeteria");
  const staffPaid = staffRows.reduce((a, x) => a + Number(x.paid_amount), 0);
  const staffLedger = recs.reduce((s, r) => s + (r.cafeteria_rows || []).filter((x) => x.kind === "staff" && x.collectionCurrency === "EGP").reduce((a, x) => a + Number(x.collectionAmt || 0), 0), 0);
  // تحصيل خدمات الجنيه على الحجوزات (مش كافيتيريا الاستاف) = مجموع other_paid بالجنيه
  const egpBookings = recs.reduce((s, r) => s + [...r.rows, ...(r.cafeteria_rows || [])].filter((x) => x.bookingId && x.collectionCurrency === "EGP").reduce((a, x) => a + Number(x.collectionAmt || 0), 0), 0);
  return { bookings, ledger, staffRows, staffPaid, staffLedger, usdCash, egpCash, egpBookings };
}
async function checkInvariants(env, label) {
  const { bookings, ledger, staffRows, staffPaid, staffLedger, egpBookings } = await snapshot(env);
  const paidSum = bookings.reduce((s, b) => s + Number(b.amount_paid), 0);
  expect(ledger, `${label}: صافي اليومية = مجموع المدفوع`).toBeCloseTo(paidSum, 2);
  expect(egpBookings, `${label}: تحصيل الجنيه في اليومية = المدفوع بالجنيه على الحجوزات`).toBeCloseTo(bookings.reduce((s, b) => s + otherPaid(b), 0), 2);
  expect(staffLedger, `${label}: سداد الاستاف في اليومية = المدفوع على استهلاكهم`).toBeCloseTo(staffPaid, 2);
  for (const e of staffRows) expect(Number(e.paid_amount), `${label}: مدفوع الاستاف مايزيدش عن المبلغ`).toBeLessThanOrEqual(Number(e.amount) + 0.005);
  for (const b of bookings) {
    expect(Number(b.amount_paid), `${label}: مدفوع غير سالب (${b.guest_name})`).toBeGreaterThanOrEqual(0);
    if (b.settled && !isOnline(b)) expect(Number(b.amount_paid), `${label}: متحصّل لازم يكون مغطّى (${b.guest_name})`).toBeGreaterThanOrEqual(grand(b) - 0.005);
    if (b.settled) expect(otherDue(b), `${label}: متحصّل لازم خدمات الجنيه تكون مغطّية (${b.guest_name})`).toBeLessThan(0.005);
    expect(otherPaid(b), `${label}: مدفوع الجنيه مايزيدش عن خدماته (${b.guest_name})`).toBeLessThanOrEqual(otherTotal(b) + 0.005);
    expect(b.refund_pending, `${label}: مفيش طلبات رد فلوس (${b.guest_name})`).toBe(false);
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
        await staff.locator(".cx-card[data-calma-editing]").getByRole("button", { name: "إلغاء", exact: true }).click({ timeout: 1500 }).catch(() => {});      // لو الفورم لسه مفتوح (مرفوض) نقفله
      },
      async collect() {
        const { bookings } = await snapshot(env);
        const c = bookings.filter((b) => b.status !== "ملغي" && b.checkin <= today && today < b.checkout && hasDue(b));
        if (!c.length) return false;
        const b = pick(c);
        log.push(`collect ${b.guest_name}`);
        await goTab(staff, "لوحة الغرف"); await openRoom(staff, b.room);
        await expect(roomCard(staff)).toContainText(b.guest_name);
        // دفعة كاملة (المبلغ فاضي = كل المتبقي) بوسيلة عشوائية - فيزا بآخر 4 أرقام، تحويل باسم ورقم
        const method = pick(["كاش", "فيزا", "فودافون كاش", "تحويل بنكي / انستاباي"]);
        // لو عليه دولار وجنيه: بنختار عملة (المبلغ فاضي = كل المتبقي بالعملة دي)
        const usdDue = hotelTotal(b) > Number(b.amount_paid) + 0.005;
        const useEgp = otherDue(b) > 0.005 && (!usdDue || rnd() < 0.5);
        if (usdDue && otherDue(b) > 0.005) { log.push(useEgp ? "  (EGP)" : "  (USD)"); await staff.getByTestId("pay-panel").getByTestId("pay-currency").selectOption(useEgp ? "EGP" : "USD"); }
        await payOnBoard(staff, { method, last4: method === "فيزا" ? "4242" : undefined, senderName: method === "فودافون كاش" || method.startsWith("تحويل") ? "Sender" : undefined, phone: method === "فودافون كاش" || method.startsWith("تحويل") ? "01012345678" : undefined });
        await expect(toast(staff)).toContainText("تم تسجيل");
      },
      async egpService() {
        const { bookings } = await snapshot(env);
        const c = bookings.filter((b) => b.status !== "ملغي" && b.checkin <= today && today < b.checkout);
        if (!c.length) return false;
        const b = pick(c);
        const svc = pick(["غسيل", "كافيتيريا", "بيك أب"]), amt = pick([50, 120, 200]);
        log.push(`egpService ${b.guest_name} ${svc} ${amt}`);
        await goTab(staff, "لوحة الغرف"); await openRoom(staff, b.room);
        await expect(roomCard(staff)).toContainText(b.guest_name);
        await roomCard(staff).getByTestId("extra-add-currency").selectOption("EGP");
        await addExtraOnBoard(staff, svc, amt);
        await expect(toast(staff)).toContainText(`${amt} EGP`);
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
      async staffAdd() {
        const mode = pick(["later", "كاش", "فيزا", "later"]);
        log.push(`staffAdd ${mode}`);
        await goTab(staff, "اليومية");
        await staff.getByTestId("staff-cafe-who").selectOption(pick(["ahmed", "rawan", "boss"]));
        await staff.getByTestId("staff-cafe-amount").fill(String(pick([10, 25, 40])));
        if (mode !== "later") await staff.getByTestId("staff-cafe-paymode").selectOption(mode);
        if (mode === "فيزا") await staff.getByTestId("staff-cafe-last4").fill("4242");
        await staff.getByTestId("staff-cafe-add").click();
        await waitIdle(staff);
        await expect(toast(staff)).toContainText("تم تسجيل الاستهلاك");
      },
      async staffSettle() {
        const n = await staff.getByTestId("staff-cafe-balance").count();
        if (!n) return false;
        log.push("staffSettle");
        await goTab(staff, "اليومية");
        await staff.getByTestId("staff-cafe-balance").first().getByTestId("staff-cafe-settle-open").click();
        const m = pick(["كاش", "فيزا"]);
        await staff.getByTestId("staff-cafe-pay-method").selectOption(m);
        if (m === "فيزا") await staff.getByTestId("staff-cafe-pay-last4").fill("1717");
        if (rnd() < 0.5) await staff.getByTestId("staff-cafe-pay-amount").fill("7");
        await staff.getByTestId("staff-cafe-pay-go").click();
        await waitIdle(staff);
      },
      async cancel() {
        const { bookings } = await snapshot(env);
        // حجز خلص (تم تسجيل الخروج) مالوش زرار إلغاء
        const c = bookings.filter((b) => b.status !== "ملغي" && b.status !== "تم تسجيل الخروج");
        if (!c.length) return false;
        const b = pick(c);
        log.push(`cancel ${b.guest_name} paid ${b.amount_paid}`);
        await goTab(res, "الحجوزات");
        await res.getByTestId("status-filter-all").click();
        // الاسم بالظبط (G1 مش G10)
        const c0 = res.locator(".cx-card").filter({ has: res.getByText(b.guest_name, { exact: true }) }).last();
        await c0.getByRole("button", { name: "إلغاء الحجز" }).click();
        await c0.getByRole("button", { name: "تأكيد الإلغاء؟" }).click();
        await expect(toast(res)).toContainText("تم إلغاء الحجز");
      },
      async move() {
        const { bookings } = await snapshot(env);
        const c = bookings.filter((b) => b.status !== "ملغي" && b.status !== "تم تسجيل الخروج" && b.checkin <= today && today < b.checkout);
        if (!c.length) return false;
        const b = pick(c);
        const free = ROOMS.filter((r) => r !== b.room && !overlaps(bookings, r, b.checkin, b.checkout, b.id));
        if (!free.length) return false;
        const to = pick(free);
        log.push(`move ${b.guest_name} ${b.room}->${to}`);
        await goTab(res, "لوحة الغرف"); await openRoom(res, b.room);
        await expect(roomCard(res)).toContainText(b.guest_name);
        await roomCard(res).getByTestId("move-open").click();
        await res.getByTestId("move-room").selectOption(String(to));
        await res.getByTestId("move-confirm").click();
        await waitIdle(res);
        await expect(toast(res)).toContainText("اتنقل");
      },
      async shorten() {
        const { bookings } = await snapshot(env);
        const c = bookings.filter((b) => b.status !== "ملغي" && nightsBetween(b.checkin, b.checkout) >= 2);
        if (!c.length) return false;
        const b = pick(c);
        const newCo = cairoDate(nightsBetween(today, b.checkin) + pick(Array.from({ length: nightsBetween(b.checkin, b.checkout) - 1 }, (_, i) => i + 1)));
        log.push(`shorten ${b.guest_name} -> ${newCo}`);
        await goTab(res, "الحجوزات");
        await res.locator(".cx-card").filter({ has: res.getByText(b.guest_name, { exact: true }) }).last().locator("button").first().click();
        await field(res, "تاريخ الخروج").fill(newCo);
        await res.getByRole("button", { name: /حفظ الحجز/ }).click();
        await expect(res.locator(".cx-card[data-calma-editing]")).toHaveCount(0);
      },
    };

    // البداية: كام حجز عشان العمليات تلاقي حاجة تشتغل عليها
    for (let i = 0; i < 3; i++) { await ops.add(); await sync(); await checkInvariants(env, `بداية ${i}`); }
    const weights = [["add", 3], ["collect", 3], ["extend", 2], ["cancel", 1], ["move", 2], ["shorten", 2], ["egpService", 2], ["earlyLeave", 2], ["addOnline", 1], ["staffAdd", 2], ["staffSettle", 2]];
    const bag = weights.flatMap(([k, w]) => Array(w).fill(k));
    for (let step = 0; step < 20; step++) {
      const op = pick(bag);
      const r = await ops[op]();
      await sync();
      await checkInvariants(env, `خطوة ${step + 1} (${log[log.length - 1] || op})`);
      if (r === false) log.push(`skip ${op}`);
    }

    // ---- النهاية: التقرير ولوحة الغرف بيطابقوا قاعدة البيانات ----
    const { bookings, usdCash, egpCash } = await snapshot(env);
    await goTab(res, "التقارير");
    const card = res.locator(".cx-report-grid .cx-card", { hasText: "إجمالي التحصيل" }).first();
    const shown = digits(await card.innerText()).replace("إجماليالتحصيل", "");
    // التقرير بيجمع كل العملات: الجنيه (سداد الاستاف) الأول ثم الدولار (الحجوزات)
    const parts = [];
    if (Math.round(egpCash * 100) !== 0) parts.push(`${Math.round(egpCash * 100) / 100}ج`);
    if (Math.round(usdCash * 100) !== 0) parts.push(`${Math.round(usdCash * 100) / 100}$`);
    expect(shown, `التقرير (${log.join(" | ")})`).toBe(parts.length ? parts.join("+") : "0");
    await goTab(res, "لوحة الغرف");
    const live = bookings.filter((b) => b.status !== "ملغي" && b.checkin <= today && today < b.checkout);
    const rooms = new Set(live.map((b) => b.room));
    const unpaid = [...rooms].filter((r) => { const b = live.find((x) => x.room === r); return hasDue(b); }).length;
    await expect(res.getByText(new RegExp(`مشغولة - متبقي فلوس ${unpaid}\\b`))).toBeVisible();
    await expect(res.getByText(new RegExp(`مشغولة - متحصّلة ${rooms.size - unpaid}\\b`))).toBeVisible();
    // غرف نزيلها غادر مبكرًا النهارده (متحسبة من الحجز نفسه) ومفيش عليها نزيل ساكن دلوقتي
    const ovRooms = new Set(bookings.filter((b) => b.left_early && b.status !== "ملغي" && b.checkout === today && !rooms.has(b.room)).map((b) => b.room));
    const soon = new Set(bookings.filter((b) => b.status !== "ملغي" && b.checkin > today && b.checkin <= cairoDate(2) && !rooms.has(b.room) && !ovRooms.has(b.room)).map((b) => b.room));
    await expect(res.getByText(new RegExp(`قادمة قريبًا ${soon.size}\\b`))).toBeVisible();
    await expect(res.getByText(new RegExp(`غادر مبكرًا ${ovRooms.size}\\b`))).toBeVisible();
    await expect(res.getByText(new RegExp(`متاحة ${16 - rooms.size - soon.size - ovRooms.size}\\b`)).first()).toBeVisible();
  });
}
