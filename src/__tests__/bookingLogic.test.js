import { describe, it, expect } from "vitest";
import { computeRoomStatus, roomsOverlap, findOverlappingBooking, findOverlappingBookings, resolveDuplicateCheckin, planDuplicateResolution, repricedTotalRoom, earlyLeavePatch, isOverrideStillActive } from "../domain/bookingLogic";

function makeBooking(overrides = {}) {
  return {
    id: "b1", room: 601, guestName: "Test Guest", checkin: "2026-09-05", checkout: "2026-09-07",
    status: "مؤكد", approvalStatus: "approved", totalRoom: 200, amountPaid: 200, settled: true,
    ...overrides,
  };
}

describe("computeRoomStatus", () => {
  it("marks a room available with no bookings or overrides", () => {
    const status = computeRoomStatus(601, [], {}, "2026-09-05");
    expect(status.key).toBe("available");
  });

  it("marks a room occupied and paid when the active booking is settled", () => {
    const booking = makeBooking();
    const status = computeRoomStatus(601, [booking], {}, "2026-09-06");
    expect(status.key).toBe("occupied_paid");
  });

  it("marks a room occupied and unpaid when balance is still due", () => {
    const booking = makeBooking({ settled: false, amountPaid: 0 });
    const status = computeRoomStatus(601, [booking], {}, "2026-09-06");
    expect(status.key).toBe("occupied_unpaid");
  });

  it("treats an online-paid booking as paid even if amountPaid is 0", () => {
    const booking = makeBooking({ settled: false, amountPaid: 0, paymentDetails: { onlinePaid: true, commissionPct: 15 } });
    const status = computeRoomStatus(601, [booking], {}, "2026-09-06");
    expect(status.key).toBe("occupied_paid");
  });

  it("shows reserved for a booking starting within the next 2 days", () => {
    const booking = makeBooking({ checkin: "2026-09-07", checkout: "2026-09-09" });
    const status = computeRoomStatus(601, [booking], {}, "2026-09-05");
    expect(status.key).toBe("reserved");
  });

  it("نزيل ساكن مابيتخباش بأي حالة يدوية (حتى الصيانة)", () => {
    const booking = makeBooking();
    const overrides = { 601: { status: "maintenance", updatedAt: Date.now() } };
    const status = computeRoomStatus(601, [booking], overrides, "2026-09-06");
    expect(status.key).toBe("occupied_paid");
  });

  it("auto-expires a non-maintenance override from a previous day", () => {
    const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
    const overrides = { 601: { status: "cleaning", updatedAt: yesterday.getTime() } };
    const status = computeRoomStatus(601, [], overrides, "2026-09-05");
    expect(status.key).toBe("available");
  });
});

describe("computeRoomStatus - paid state follows the money, not just the settled flag", () => {
  it("shows unpaid when the booking is flagged settled but the total grew (extension) and money is still due", () => {
    const booking = makeBooking({ settled: true, totalRoom: 400, amountPaid: 200 });
    expect(computeRoomStatus(601, [booking], {}, "2026-09-06").key).toBe("occupied_unpaid");
  });
  it("shows paid once the paid amount reaches the new total", () => {
    const booking = makeBooking({ settled: false, totalRoom: 400, amountPaid: 400 });
    expect(computeRoomStatus(601, [booking], {}, "2026-09-06").key).toBe("occupied_paid");
  });
});

describe("isOverrideStillActive", () => {
  it("keeps maintenance active indefinitely", () => {
    const oldOverride = { status: "maintenance", updatedAt: new Date(2020, 0, 1).getTime() };
    expect(isOverrideStillActive(oldOverride, "2026-09-05")).toBe(true);
  });
  it("expires cleaning status the next day", () => {
    const override = { status: "cleaning", updatedAt: new Date(2026, 8, 4).getTime() };
    expect(isOverrideStillActive(override, "2026-09-05")).toBe(false);
  });
});

describe("roomsOverlap", () => {
  const existing = [makeBooking()];
  it("detects a genuine overlap", () => {
    expect(roomsOverlap(existing, 601, "2026-09-06", "2026-09-08")).toBe(true);
  });
  it("allows a non-overlapping stay right after checkout", () => {
    expect(roomsOverlap(existing, 601, "2026-09-07", "2026-09-09")).toBe(false);
  });
  it("ignores cancelled bookings", () => {
    const cancelled = [makeBooking({ status: "ملغي" })];
    expect(roomsOverlap(cancelled, 601, "2026-09-05", "2026-09-07")).toBe(false);
  });
  it("excludes the booking's own id when editing itself", () => {
    expect(roomsOverlap(existing, 601, "2026-09-05", "2026-09-07", "b1")).toBe(false);
  });
});

describe("resolveDuplicateCheckin (early-checkout / duplicate check-in)", () => {
  const TODAY = "2026-09-07";
  it("trims the old booking's checkout when it started before the new check-in", () => {
    const clash = makeBooking({ checkin: "2026-09-05", checkout: "2026-09-10" });
    expect(resolveDuplicateCheckin(clash, "2026-09-07", TODAY)).toEqual({ action: "trim", checkout: "2026-09-07" });
  });

  it("same-day case (old and new both start today): recorded as an EARLY LEAVE with zero nights (never cancelled, never blocked as 'not started')", () => {
    // ده بالظبط السيناريو اللي اتبلّغ عنه: حجزين على نفس يوم النهارده كانوا
    // بيطلّعوا "الحجز القديم لسه لم يبدأ" غلط، مع إن تاريخ دخوله النهارده.
    const clash = makeBooking({ checkin: "2026-09-07", checkout: "2026-09-08" });
    expect(resolveDuplicateCheckin(clash, "2026-09-07", TODAY)).toEqual({ action: "early_leave_same_day", checkout: "2026-09-07" });
  });

  it("a real future booking (starts after today) is a true double-booking and needs the reservations manager", () => {
    const clash = makeBooking({ checkin: "2026-09-12", checkout: "2026-09-14" });
    expect(resolveDuplicateCheckin(clash, "2026-09-12", TODAY)).toEqual({ action: "needs_manual_cancel", reason: "future" });
  });

  it("a back-dated new booking that starts before the old one is rejected as inconsistent dates", () => {
    const clash = makeBooking({ checkin: "2026-09-07", checkout: "2026-09-10" });
    expect(resolveDuplicateCheckin(clash, "2026-09-05", TODAY)).toEqual({ action: "needs_manual_cancel", reason: "starts_before_old" });
  });

  it("a new check-in in the FUTURE inside a stay whose guest is still in the room is not an early checkout", () => {
    const clash = makeBooking({ checkin: "2026-09-05", checkout: "2026-09-12" });
    expect(resolveDuplicateCheckin(clash, "2026-09-09", TODAY)).toEqual({ action: "needs_manual_cancel", reason: "new_in_future" });
  });

  it("returns null when there is no clashing booking", () => {
    expect(resolveDuplicateCheckin(null, "2026-09-07", TODAY)).toBe(null);
  });
});

describe("planDuplicateResolution (all clashes decided before anything is touched)", () => {
  const TODAY = "2026-09-07";
  it("is ok with an empty action list when there is no clash", () => {
    expect(planDuplicateResolution([], "2026-09-07", TODAY)).toEqual({ ok: true, actions: [] });
  });
  it("plans a trim + a void for two old bookings", () => {
    const a = makeBooking({ id: "a", checkin: "2026-09-05", checkout: "2026-09-08" });
    const b = makeBooking({ id: "b", checkin: "2026-09-07", checkout: "2026-09-09" });
    const plan = planDuplicateResolution([a, b], "2026-09-07", TODAY);
    expect(plan.ok).toBe(true);
    expect(plan.actions.map((x) => x.action)).toEqual(["trim", "early_leave_same_day"]);
  });
  it("rejects the WHOLE plan if any one clash is a real future booking", () => {
    const a = makeBooking({ id: "a", checkin: "2026-09-05", checkout: "2026-09-08" });
    const b = makeBooking({ id: "b", checkin: "2026-09-08", checkout: "2026-09-10" });
    const plan = planDuplicateResolution([a, b], "2026-09-06", TODAY);
    expect(plan.ok).toBe(false);
    expect(plan.reason).toBe("future");
    expect(plan.clash.id).toBe("b");
  });
});

describe("repricedTotalRoom (extension / shortening follows the nightly price)", () => {
  const original = { checkin: "2026-09-05", checkout: "2026-09-07", priceNight: 1000, totalRoom: 2000 };
  it("adds nights at the agreed nightly price on extension", () => {
    expect(repricedTotalRoom(original, "2026-09-05", "2026-09-09")).toBe(4000);
  });
  it("removes nights when shortened", () => {
    expect(repricedTotalRoom(original, "2026-09-05", "2026-09-06")).toBe(1000);
  });
  it("keeps a negotiated total untouched when the number of nights did not change", () => {
    const negotiated = { ...original, totalRoom: 1700 };
    expect(repricedTotalRoom(negotiated, "2026-09-06", "2026-09-08")).toBe(1700);
  });
  it("a heavily discounted stay is reduced proportionally (never negative, never billed zero for nights stayed)", () => {
    expect(repricedTotalRoom({ ...original, totalRoom: 500 }, "2026-09-05", "2026-09-06")).toBe(250);
  });
});

describe("findOverlappingBooking(s)", () => {
  it("returns the actual overlapping booking object, not just a boolean", () => {
    const existing = [makeBooking({ id: "b1", checkin: "2026-09-05", checkout: "2026-09-10" })];
    const found = findOverlappingBooking(existing, 601, "2026-09-07", "2026-09-12");
    expect(found?.id).toBe("b1");
  });
  it("returns null when there is no overlap", () => {
    const existing = [makeBooking({ id: "b1", checkin: "2026-09-05", checkout: "2026-09-07" })];
    expect(findOverlappingBooking(existing, 601, "2026-09-07", "2026-09-09")).toBe(null);
  });
  it("findOverlappingBookings returns every overlapping active booking and skips cancelled/other rooms", () => {
    const existing = [
      makeBooking({ id: "a", checkin: "2026-09-05", checkout: "2026-09-08" }),
      makeBooking({ id: "b", checkin: "2026-09-08", checkout: "2026-09-10" }),
      makeBooking({ id: "c", checkin: "2026-09-06", checkout: "2026-09-09", status: "ملغي" }),
      makeBooking({ id: "d", room: 602, checkin: "2026-09-06", checkout: "2026-09-09" }),
    ];
    expect(findOverlappingBookings(existing, 601, "2026-09-07", "2026-09-09").map((x) => x.id)).toEqual(["a", "b"]);
  });
});

describe("earlyLeavePatch (nights stayed are billed, min 1 night)", () => {
  it("same-day leave: left-early, checkout = checkin, total/paid/settled UNTOUCHED, never cancelled", () => {
    const c = makeBooking({ checkin: "2026-09-07", checkout: "2026-09-08", priceNight: 1200, totalRoom: 1200, amountPaid: 1200, settled: true });
    const p = earlyLeavePatch(c, "2026-09-07");
    expect(p).toMatchObject({ checkout: "2026-09-07", status: "تم تسجيل الخروج", leftEarly: true });
    expect(p.status).not.toBe("ملغي");
    expect(p.totalRoom).toBe(1200); // minimum 1 night is charged
    expect(p.settled).toBe(true);
    expect(p.amountPaid).toBeUndefined();
  });
  it("multi-night booking left same day: 1 night charged, rest reprices down", () => {
    const c = makeBooking({ checkin: "2026-09-07", checkout: "2026-09-10", priceNight: 400, totalRoom: 1200, amountPaid: 1200, settled: true });
    const p = earlyLeavePatch(c, "2026-09-07");
    expect(p.totalRoom).toBe(400);
    expect(p.amountPaid).toBeUndefined();
  });
  it("trim only moves the checkout date and adds a note", () => {
    const c = makeBooking({ checkin: "2026-09-05", checkout: "2026-09-09", notes: "x" });
    const p = earlyLeavePatch(c, "2026-09-07");
    expect(p.checkout).toBe("2026-09-07");
    expect(p.notes.startsWith("x — ")).toBe(true);
  });
});

describe("repricedTotalRoom (discount-aware, matches DB reprice_total)", () => {
  it("shortening uses the average nightly rate (discounted 3 nights = 900 -> 1 night = 300)", () => {
    const b = { checkin: "2026-09-05", checkout: "2026-09-08", priceNight: 400, totalRoom: 900 };
    expect(repricedTotalRoom(b, "2026-09-05", "2026-09-06")).toBe(300);
    expect(repricedTotalRoom(b, "2026-09-05", "2026-09-07")).toBe(600);
  });
  it("same-day leave is charged a minimum of 1 night", () => {
    expect(repricedTotalRoom({ checkin: "2026-09-05", checkout: "2026-09-06", priceNight: 0, totalRoom: 1000 }, "2026-09-05", "2026-09-05")).toBe(1000);
  });
  it("extension adds the booking's nightly rate", () => {
    expect(repricedTotalRoom({ checkin: "2026-09-05", checkout: "2026-09-06", priceNight: 1400, totalRoom: 1400 }, "2026-09-05", "2026-09-07")).toBe(2800);
  });
  it("zero-night (empty range) bookings never count as a clash", () => {
    const zero = makeBooking({ id: "z", checkin: "2026-09-07", checkout: "2026-09-07", status: "تم تسجيل الخروج" });
    expect(findOverlappingBookings([zero], 601, "2026-09-06", "2026-09-09")).toEqual([]);
    expect(roomsOverlap([zero], 601, "2026-09-06", "2026-09-09")).toBe(false);
  });
});


describe("computeRoomStatus - الحالات اليدوية والمغادرة المبكرة", () => {
  const T = new Date(2026, 8, 10, 12, 0, 0).getTime();       // ١٠ سبتمبر ١٢ ظهرًا (بتوقيت الجهاز)
  const today = "2026-09-10";
  const mk = (over) => ({ id: "x", room: 601, status: "مؤكد", checkin: today, checkout: "2026-09-12", amountPaid: 0, totalRoom: 100, extras: {}, ...over });
  const ovAt = (status, updatedAt) => ({ 601: { status, updatedAt } });

  it("نزيل ساكن => هو اللي يبان مهما كانت الحالة اليدوية (تنظيف/صيانة/غادر مبكرًا القديمة)", () => {
    for (const st of ["cleaning", "maintenance", "early_checkout"]) {
      const s = computeRoomStatus(601, [mk({ guestName: "G", createdAt: T - 5000 })], ovAt(st, T), today);
      expect(s.key, st).toBe("occupied_unpaid");
      expect(s.booking.guestName).toBe("G");
    }
  });
  it("من غير نزيل: الصيانة والتنظيف بيظهروا", () => {
    expect(computeRoomStatus(601, [], ovAt("maintenance", T), today).key).toBe("maintenance");
    expect(computeRoomStatus(601, [], ovAt("cleaning", T), today).key).toBe("cleaning");
  });
  it("حالة 'غادر مبكرًا' اليدوية القديمة مابقتش بتتعامل كحالة (اتشالت)", () => {
    expect(computeRoomStatus(601, [], ovAt("early_checkout", T), today).key).toBe("available");
  });
  it("نزيل غادر مبكرًا النهارده => الغرفة 'غادر مبكرًا' (متحسبة من الحجز نفسه)", () => {
    const left = mk({ guestName: "Gone", checkin: "2026-09-08", checkout: today, leftEarly: true });
    const s = computeRoomStatus(601, [left], {}, today);
    expect(s.key).toBe("early_checkout");
    expect(s.guest).toBe("Gone");
    expect(computeRoomStatus(601, [left], {}, "2026-09-11").key).toBe("available");        // تاني يوم رجعت متاحة
  });
  it("غادر مبكرًا ونزيل جديد اتسكّن => الجديد هو اللي يبان", () => {
    const left = mk({ id: "old", guestName: "Gone", checkin: "2026-09-08", checkout: today, leftEarly: true });
    const nw = mk({ id: "new", guestName: "New", checkin: today, checkout: "2026-09-12", duplicatePlacement: true });
    expect(computeRoomStatus(601, [left, nw], {}, today).guest).toBe("New");
  });
  it("حجز ملغي ومعلّم غادر مبكرًا مايظهرش كغادر", () => {
    expect(computeRoomStatus(601, [mk({ checkout: today, checkin: "2026-09-08", leftEarly: true, status: "ملغي" })], {}, today).key).toBe("available");
  });
});
