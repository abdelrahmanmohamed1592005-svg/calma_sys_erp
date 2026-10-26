/*
  إدخالات غريبة وسلوك المستخدم الحقيقي: أرقام عربية، كسور، مبالغ غلط، ضغط مزدوج سريع،
  نصوص خبيثة/طويلة، وشاشة موبايل صغيرة. بنتأكد من القاعدة نفسها إن مفيش فلوس بتتكرر أو بتتشوّه.
*/
import { test, expect } from "../fixtures";
import { login, claimShift, addBooking, goTab, toast, openRoom, payOnBoard, waitIdle, digits } from "../ui";

async function users(env) {
  await env.seedUser("boss", "gm", "المدير");
  await env.seedUser("ahmed", "staff", "أحمد");
  await env.seedUser("rawan", "reservations", "روان");
}
const booking = async (env, guest) => (await env.q("select * from bookings where guest_name = $1", [guest]))[0];
const shift = async (env) => (await env.q("select * from shift_records"))[0];

test.describe("إدخالات غريبة", () => {
  test("آخر 4 أرقام وتليفون التحويل بأرقام عربية بيتحوّلوا لأرقام عادية في القاعدة", async ({ page, env }) => {
    await users(env);
    await env.seedShift("ahmed");
    await env.seedBooking({ room: 601, guest: "Arabic Digits", nights: 2, price: 100 });
    await page.goto("/"); await login(page, "ahmed");
    await goTab(page, "لوحة الغرف"); await openRoom(page, 601);
    await payOnBoard(page, { amount: 50, method: "فيزا", last4: "4242" });
    await expect.poll(async () => Number((await booking(env, "Arabic Digits")).amount_paid), { timeout: 8000 }).toBe(50);
    await payOnBoard(page, { amount: 40, method: "فودافون كاش", senderName: "منى", phone: "01012345678" });
    await expect.poll(async () => Number((await booking(env, "Arabic Digits")).amount_paid), { timeout: 8000 }).toBe(90);
    const rows = (await shift(env)).rows.filter((r) => Number(r.collectionAmt) !== 0);
    const visa = rows.find((r) => r.collectionMethod === "فيزا");
    const voda = rows.find((r) => r.collectionMethod === "فودافون كاش");
    expect(visa.paymentDetails.senderNumber).toBe("4242");
    expect(voda.paymentDetails.senderNumber).toBe("01012345678");
  });

  test("مبالغ غلط: صفر وسالب وأكبر من المتبقي بتتقفل ومفيش حاجة بتتسجّل، والكسور بتتقرّب لقرشين", async ({ page, env }) => {
    await users(env);
    await env.seedShift("ahmed");
    await env.seedBooking({ room: 601, guest: "Bad Amounts", nights: 1, price: 100 });
    await page.goto("/"); await login(page, "ahmed");
    await goTab(page, "لوحة الغرف"); await openRoom(page, 601);
    for (const bad of ["0", "-5", "100.01", "99999"]) {
      await page.getByTestId("pay-amount").fill(bad);
      await page.getByTestId("pay-record").click();
      await waitIdle(page);
      expect(Number((await booking(env, "Bad Amounts")).amount_paid), `مبلغ ${bad}`).toBe(0);
    }
    await payOnBoard(page, { amount: "33.333" });
    await expect.poll(async () => Number((await booking(env, "Bad Amounts")).amount_paid), { timeout: 8000 }).toBe(33.33);
    const total = (await shift(env)).rows.reduce((a, r) => a + (Number(r.collectionAmt) || 0), 0);
    expect(Math.round(total * 100) / 100).toBe(33.33);
  });

  test("ضغط مزدوج سريع على تسجيل الدفعة: دفعة واحدة بس في الحجز واليومية", async ({ page, env }) => {
    await users(env);
    await env.seedShift("ahmed");
    await env.seedBooking({ room: 601, guest: "Double Click", nights: 2, price: 100 });
    await page.goto("/"); await login(page, "ahmed");
    await goTab(page, "لوحة الغرف"); await openRoom(page, 601);
    await page.getByTestId("pay-amount").fill("70");
    await page.getByTestId("pay-record").dblclick();
    await page.getByTestId("pay-record").click({ force: true }).catch(() => {});
    await waitIdle(page);
    await page.waitForTimeout(800);
    expect(Number((await booking(env, "Double Click")).amount_paid)).toBe(70);
    const total = (await shift(env)).rows.reduce((a, r) => a + (Number(r.collectionAmt) || 0), 0);
    expect(total).toBe(70);
  });

  test("اسم نزيل بنص خبيث/طويل: بيتقصّ لـ 120 حرف، بيتعرض كنص عادي ومفيش سكريبت بيتنفّذ", async ({ page, env }) => {
    await users(env);
    await env.seedShift("ahmed");
    let dialogs = 0;
    page.on("dialog", async (d) => { dialogs++; await d.dismiss(); });
    await page.goto("/"); await login(page, "ahmed");
    const evil = `<img src=x onerror=alert(1)><script>alert(2)</script> ${"س".repeat(300)}`;
    await addBooking(page, { room: 601, guest: evil, price: 100, nights: 1 });
    await goTab(page, "لوحة الغرف");
    await page.waitForTimeout(600);
    expect(dialogs).toBe(0);
    const [b] = await env.q("select guest_name from bookings");
    expect(b.guest_name.length).toBeLessThanOrEqual(120);
    // بيتحفظ كنص (React بيهرّبه في العرض ومفيش innerHTML في الكود) - المهم إنه ماتنفّذش ولا ظهر كعنصر
    await expect(page.locator("script", { hasText: "alert(2)" })).toHaveCount(0);
    await expect(page.locator("img[src='x']")).toHaveCount(0);
  });
});

test.describe("شاشة موبايل صغيرة", () => {
  test.use({ viewport: { width: 360, height: 640 } });
  test("لوحة الغرف والدفع شغالين على 360px من غير سكرول أفقي للصفحة", async ({ page, env }) => {
    await users(env);
    await env.seedShift("ahmed");
    await env.seedBooking({ room: 601, guest: "Phone User", nights: 2, price: 100 });
    await page.goto("/"); await login(page, "ahmed");
    await goTab(page, "لوحة الغرف"); await openRoom(page, 601);
    await payOnBoard(page, { amount: 60 });
    await expect.poll(async () => Number((await booking(env, "Phone User")).amount_paid), { timeout: 8000 }).toBe(60);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(2);
    await goTab(page, "الحجوزات");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(2);
  });
});
