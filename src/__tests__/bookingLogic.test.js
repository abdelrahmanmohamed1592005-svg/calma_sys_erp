import { describe, it, expect } from "vitest";
import { computeRoomStatus, roomsOverlap, findOverlappingBooking, resolveDuplicateCheckin, isOverrideStillActive } from "../domain/bookingLogic";

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

  it("respects a maintenance override even with an active booking", () => {
    const booking = makeBooking();
    const overrides = { 601: { status: "maintenance", updatedAt: Date.now() } };
    const status = computeRoomStatus(601, [booking], overrides, "2026-09-06");
    expect(status.key).toBe("maintenance");
  });

  it("auto-expires a non-maintenance override from a previous day", () => {
    const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
    const overrides = { 601: { status: "cleaning", updatedAt: yesterday.getTime() } };
    const status = computeRoomStatus(601, [], overrides, "2026-09-05");
    expect(status.key).toBe("available");
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

describe("resolveDuplicateCheckin (early-checkout / duplicate check-in fix)", () => {
  // هذا الاختبار يغطي باگ تحطيم الحجز القديم (constraint bookings_dates_valid)
  // اللي كان بيحصل لما الضيف القديم يخرج بدري ويتسجل حجز جديد شرعي نفس اليوم.
  it("trims the old booking's checkout when it genuinely started earlier", () => {
    const clash = makeBooking({ checkin: "2026-09-05", checkout: "2026-09-10" });
    const resolution = resolveDuplicateCheckin(clash, "2026-09-07");
    expect(resolution).toEqual({ action: "trim", checkout: "2026-09-07" });
  });

  it("cancels the old booking instead of producing an invalid checkout<=checkin when both start the same day", () => {
    // ده بالظبط السيناريو اللي كان بيرمي خطأ bookings_dates_valid: الحجز
    // القديم بيبدأ في نفس يوم الحجز الجديد، فتقصيره كان هيخلي checkout==checkin.
    const clash = makeBooking({ checkin: "2026-09-07", checkout: "2026-09-10" });
    const resolution = resolveDuplicateCheckin(clash, "2026-09-07");
    expect(resolution).toEqual({ action: "cancel" });
  });

  it("cancels the old booking when it starts after the new check-in", () => {
    const clash = makeBooking({ checkin: "2026-09-08", checkout: "2026-09-10" });
    const resolution = resolveDuplicateCheckin(clash, "2026-09-07");
    expect(resolution).toEqual({ action: "cancel" });
  });

  it("returns null when there is no clashing booking", () => {
    expect(resolveDuplicateCheckin(null, "2026-09-07")).toBe(null);
  });
});

describe("findOverlappingBooking", () => {
  it("returns the actual overlapping booking object, not just a boolean", () => {
    const existing = [makeBooking({ id: "b1", checkin: "2026-09-05", checkout: "2026-09-10" })];
    const found = findOverlappingBooking(existing, 601, "2026-09-07", "2026-09-12");
    expect(found?.id).toBe("b1");
  });
  it("returns null when there is no overlap", () => {
    const existing = [makeBooking({ id: "b1", checkin: "2026-09-05", checkout: "2026-09-07" })];
    expect(findOverlappingBooking(existing, 601, "2026-09-07", "2026-09-09")).toBe(null);
  });
});
