import { describe, it, expect } from "vitest";
import { computeRoomStatus, roomsOverlap, isOverrideStillActive } from "../domain/bookingLogic";

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
