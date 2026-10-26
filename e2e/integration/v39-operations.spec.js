/*
  تعديلات التشغيل (قاعدة البيانات v39) من الشاشات فوق قاعدة بيانات حقيقية:
  الدفع بعملة غير عملة الحجز بسعر صرف وقت الدفع، نقل النزيل لغرفة تانية بالحجز كله،
  إضافة الخدمات (بتتضاف مش بتستبدل)، الأونلاين بيغطي سعر الغرفة بس، والشيفت اللي معاده خلص.
*/
import { test, expect } from "../fixtures";
import { login, logout, goTab, toast, digits, openRoom, roomCard, boardTile, payOnBoard, addExtraOnBoard, cairoHour, shiftDay, waitIdle } from "../ui";

async function users(env) {
  await env.seedUser("boss", "gm", "المدير");
  await env.seedUser("ahmed", "staff", "أحمد");
  await env.seedUser("rawan", "reservations", "روان");
}
const get = async (env, id) => (await env.q("select * from bookings where id = $1", [id]))[0];
const fxRows = async (env, id) => (await env.q("select rows from shift_records")).flatMap((r) => r.rows).filter((x) => x.bookingId === id && Number(x.collectionAmt));

test("الدفع بعملة تانية من بطاقة الغرفة: الموظف بيختار العملة وبيكتب سعر الصرف، والمتبقي بيقل بالمقابل بعملة الحجز، واليومية بالعملة الفعلية", async ({ page, env }) => {
  await users(env);
  await env.seedShift("ahmed");
  const id = await env.seedBooking({ room: 603, guest: "FX Guest", nights: 2, price: 100 });
  await page.goto("/"); await login(page, "ahmed");
  await goTab(page, "لوحة الغرف");
  await openRoom(page, 603);
  const panel = page.getByTestId("pay-panel");
  // عملة مختلفة من غير سعر صرف: مرفوض
  await panel.getByTestId("pay-currency").selectOption("EGP");
  await panel.getByTestId("pay-amount").fill("5000");
  await panel.getByTestId("pay-record").click();
  await expect(toast(page)).toContainText("اكتب سعر الصرف");
  expect(Number((await get(env, id)).amount_paid)).toBe(0);
  // 5000 جنيه بسعر 50 = 100 دولار
  await panel.getByTestId("pay-rate").fill("50");
  await expect(panel.getByTestId("pay-fx-preview")).toContainText("100");
  await panel.getByTestId("pay-record").click();
  await waitIdle(page);
  await expect(toast(page)).toContainText("EGP (= 100 USD");
  expect(digits(await toast(page).innerText())).toContain("المتبقي100USD");
  let b = await get(env, id);
  expect(b).toMatchObject({ amount_paid: 100, settled: false });
  // الباقي باليورو: المبلغ فاضي = كامل المتبقي بسعر الصرف (100 × 0.9 = 90 يورو)
  await panel.getByTestId("pay-currency").selectOption("EUR");
  await panel.getByTestId("pay-rate").fill("0.9");
  await expect(panel.getByTestId("pay-fx-preview")).toContainText("100");
  await panel.getByTestId("pay-record").click();
  await waitIdle(page);
  await expect(toast(page)).toContainText("الحجز مدفوع بالكامل");
  b = await get(env, id);
  expect(b).toMatchObject({ amount_paid: 200, settled: true });
  const rows = await fxRows(env, id);
  expect(rows.map((r) => [r.collectionCurrency, Number(r.collectionAmt), Number(r.fxCovered), r.fxBookingCurrency]).sort()).toEqual([["EGP", 5000, 100, "USD"], ["EUR", 90, 100, "USD"]]);
  // التقرير: التحصيل بيظهر بالعملة اللي اتدفعت بيها فعلًا (جنيه ويورو) - مش بالدولار
  await logout(page); await login(page, "rawan");
  await goTab(page, "التقارير");
  const total = page.locator(".cx-report-grid .cx-card", { hasText: "إجمالي التحصيل" }).first();
  await expect(total).toBeVisible();
  await expect.poll(async () => digits(await total.innerText())).toMatch(/5000ج/);
  expect(digits(await total.innerText())).toMatch(/90€|90EUR/);
  expect(digits(await total.innerText())).not.toMatch(/200\$/);         // مش متسجّلة كدولار
});

test("الدفع بعملة تانية من قايمة الحجوزات (تحصيل سريع)", async ({ page, env }) => {
  await users(env);
  await env.seedShift("ahmed");
  const id = await env.seedBooking({ room: 607, guest: "FX Far", start: 10, nights: 2, price: 100 });
  await page.goto("/"); await login(page, "ahmed");
  await goTab(page, "الحجوزات");
  await page.getByTestId("status-filter-all").click();
  const c = page.locator(".cx-card", { hasText: "FX Far" }).last();
  await c.getByTestId("quickpay-open").click();
  await c.getByTestId("quickpay-currency").selectOption("EGP");
  await c.getByTestId("quickpay-rate").fill("50");
  await c.getByTestId("quickpay-amount").fill("2500");
  await c.getByTestId("quickpay-submit").click();
  await expect(toast(page)).toContainText("تم تسجيل");
  await expect.poll(async () => Number((await get(env, id)).amount_paid), { timeout: 8000 }).toBe(50);
  expect((await fxRows(env, id)).map((r) => [r.collectionCurrency, Number(r.collectionAmt)])).toEqual([["EGP", 2500]]);
});

test("نقل النزيل لغرفة تانية: الحجز كله بيتنقل بكل تفاصيله، الغرفة القديمة بتفضى، والغرف المشغولة في نفس التواريخ مش في القايمة", async ({ page, env }) => {
  await users(env);
  await env.seedShift("ahmed");
  const id = await env.seedBooking({ room: 603, guest: "Mover", start: -1, nights: 3, price: 100, paid: 120, extras: { laundry: 20, cafeteria: 0, tours: 0, pickup: 0 } });
  await env.seedBooking({ room: 604, guest: "Blocker", start: 1, nights: 2, price: 100 });        // 604 مشغولة جوه مدة الحجز
  await page.goto("/"); await login(page, "ahmed");
  await goTab(page, "لوحة الغرف");
  await openRoom(page, 603);
  await roomCard(page).getByTestId("move-open").click();
  const sel = page.getByTestId("move-room");
  await expect(sel.locator("option[value='604']")).toHaveCount(0);
  await expect(sel.locator("option[value='603']")).toHaveCount(0);
  await sel.selectOption("605");
  await page.getByTestId("move-confirm").click();
  await waitIdle(page);
  await expect(toast(page)).toContainText("اتنقل Mover");
  const b = await get(env, id);
  expect(b).toMatchObject({ room: 605, amount_paid: 120, total_room: 300, status: "مؤكد" });
  expect(b.extras).toMatchObject({ laundry: 20 });
  await expect(roomCard(page)).toContainText("Mover");                         // البطاقة اتحوّلت على الغرفة الجديدة
  await expect(boardTile(page, 603)).not.toContainText("Mover");
  await expect(boardTile(page, 605)).toContainText("Mover");
  const [{ n }] = await env.q("select count(*)::int n from activity_log where action like '%نقل نزيل%'");
  expect(n).toBe(1);
});

test("إضافة خدمة بتتجمّع على اللي موجود (حتى لو جاية من الحجز)، والتصحيح زرار لوحده بيستبدل الإجمالي", async ({ page, env }) => {
  await users(env);
  await env.seedShift("ahmed");
  const id = await env.seedBooking({ room: 602, guest: "Services", nights: 2, price: 100, extras: { laundry: 0, cafeteria: 0, tours: 30, pickup: 0 } });
  await page.goto("/"); await login(page, "ahmed");
  await goTab(page, "لوحة الغرف");
  await openRoom(page, 602);
  await expect(roomCard(page).getByTestId("extras-current")).toContainText("30");
  await addExtraOnBoard(page, "جولات", 20);
  await expect(toast(page)).toContainText("إجمالي جولات على الحجز بقى 50");
  await addExtraOnBoard(page, "جولات", 20);                                    // نفس الخدمة مرتين = بتتجمّع
  await expect.poll(async () => (await get(env, id)).extras.tours).toBe(70);
  await addExtraOnBoard(page, "غسيل", 15);
  await expect.poll(async () => (await get(env, id)).extras.laundry).toBe(15);
  // التصحيح: الرقم بيحل محل الإجمالي
  await roomCard(page).getByTestId("extras-fix-toggle").click();
  await roomCard(page).getByTestId("extras-fix").getByLabel("جولات").fill("60");
  await roomCard(page).getByRole("button", { name: /حفظ التصحيح/ }).click();
  await waitIdle(page);
  await expect.poll(async () => (await get(env, id)).extras).toMatchObject({ tours: 60, laundry: 15 });
});

test("حجز مدفوع أونلاين: الأونلاين غطّى سعر الغرفة بس - تمديده من الموظف بيطلّع الليلة الزيادة متبقي في الفندق", async ({ page, env }) => {
  await users(env);
  await env.seedShift("ahmed");
  const id = await env.seedBooking({ room: 606, guest: "Online Ext", nights: 1, price: 100, payment_details: { senderName: "", senderNumber: "", ref: "BK1", onlinePaid: true, commissionPct: 15, onlineRoomAmount: 100 } });
  await page.goto("/"); await login(page, "ahmed");
  await goTab(page, "لوحة الغرف");
  await openRoom(page, 606);
  await roomCard(page).getByRole("button", { name: /تمديد الحجز/ }).click();
  await expect(toast(page)).toContainText("تم تمديد الحجز");
  const b = await get(env, id);
  expect(b).toMatchObject({ total_room: 200, settled: false });
  expect(b.payment_details.onlineRoomAmount).toBe(100);
  expect(digits(await roomCard(page).getByTestId("money-box").innerText())).toContain("المتبقيفيالفندق(خدمات/دخولمبكر/تمديد)100");
  await payOnBoard(page);
  await expect(toast(page)).toContainText("الحجز مدفوع بالكامل");
  expect(await get(env, id)).toMatchObject({ amount_paid: 100, settled: true });
});

test("إدارة المستخدمين: شيفت معاده خلص مايتلغيش اختياره، والشيفت الشغال/الجاي يتلغي عادي", async ({ page, env }) => {
  await users(env);
  await env.seedUser("sara", "staff", "سارة");
  await env.seedUser("omar", "staff", "عمر");
  const day = shiftDay();
  for (const [key, u] of [["morning", "ahmed"], ["evening", "sara"], ["night", "omar"]]) {
    await env.q("insert into shift_claims(date, shift_key, username, name) select $1, $2, username, name from profiles where username = $3", [day, key, u]);
  }
  const h = cairoHour();
  const over = h < 8 ? ["morning", "evening"] : h >= 16 ? ["morning"] : [];
  await page.goto("/"); await login(page, "boss");
  await goTab(page, "إدارة المستخدمين");
  for (const key of ["morning", "evening", "night"]) {
    if (over.includes(key)) await expect(page.getByTestId("claim-over-" + key)).toBeVisible();
    else await expect(page.getByTestId("claim-over-" + key)).toHaveCount(0);
  }
  const open = ["morning", "evening", "night"].find((k) => !over.includes(k));
  const btns = page.getByRole("button", { name: "إلغاء الاختيار" });
  await expect(btns).toHaveCount(3 - over.length);
  await btns.first().click();
  await page.getByRole("button", { name: /مسح ورقة اليومية وإلغاء الاختيار/ }).click();
  await waitIdle(page);
  await expect.poll(async () => (await env.q("select shift_key from shift_claims where date = $1 order by shift_key", [day])).map((r) => r.shift_key).sort())
    .toEqual(["morning", "evening", "night"].filter((k) => k !== open).sort());
});

test("بيك أب جاي من الحجز + غسيل وكافيتيريا: كل خدمة تتضاف أكتر من مرة ورا بعض، والحجز مابيتلغيش ولا حاجة بتتمسح", async ({ page, env }) => {
  await users(env);
  await env.seedShift("ahmed");
  const id = await env.seedBooking({ room: 605, guest: "Pickup Guest", nights: 2, price: 100, extras: { laundry: 0, cafeteria: 0, tours: 0, pickup: 25 } });
  await page.goto("/"); await login(page, "ahmed");
  await goTab(page, "لوحة الغرف");
  await openRoom(page, 605);
  await expect(roomCard(page).getByTestId("extras-current")).toContainText("25");
  for (const [label, key, amt] of [["بيك أب", "pickup", 15], ["بيك أب", "pickup", 15], ["غسيل", "laundry", 10], ["غسيل", "laundry", 10], ["كافيتيريا", "cafeteria", 30], ["كافيتيريا", "cafeteria", 20]]) {
    const before = Number((await get(env, id)).extras[key]) || 0;
    await addExtraOnBoard(page, label, amt);
    await expect.poll(async () => Number((await get(env, id)).extras[key])).toBe(before + amt);
    await expect(roomCard(page).getByTestId("extra-add-amount")).toHaveValue("");     // الخانة بتفضى للإضافة الجاية
  }
  const b = await get(env, id);
  expect(b.extras).toMatchObject({ pickup: 55, laundry: 20, cafeteria: 50 });
  expect(b.status).toBe("مؤكد");
  await expect(roomCard(page)).toContainText("Pickup Guest");
});
