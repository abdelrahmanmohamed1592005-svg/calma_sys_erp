import { describe, it, expect } from "vitest";
import { computeRoomStatus, roomsOverlap, classifyBookingAgainstSet, isOverrideStillActive } from "../domain/bookingLogic";

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

  it("ignores pending (unapproved) bookings for occupied status", () => {
    const booking = makeBooking({ approvalStatus: "pending" });
    const status = computeRoomStatus(601, [booking], {}, "2026-09-06");
    expect(status.key).toBe("pending_approval");
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

describe("classifyBookingAgainstSet - import dedup logic", () => {
  it("classifies a brand-new booking with no conflicts as new", () => {
    const draft = { room: 605, checkin: "2026-09-10", checkout: "2026-09-12", code: "" };
    const result = classifyBookingAgainstSet(draft, []);
    expect(result.matchType).toBe("new");
  });

  it("matches an existing booking by code even if dates changed (extension)", () => {
    const existing = [makeBooking({ code: "BDC123", checkin: "2026-09-05", checkout: "2026-09-07" })];
    const draft = { room: 601, checkin: "2026-09-05", checkout: "2026-09-10", code: "BDC123" };
    const result = classifyBookingAgainstSet(draft, existing);
    expect(result.matchType).toBe("update");
    expect(result.matchedExistingId).toBe("b1");
  });

  it("treats an exact room+date re-upload with no code as an update, not a duplicate", () => {
    const existing = [makeBooking({ code: "" })];
    const draft = { room: 601, checkin: "2026-09-05", checkout: "2026-09-07", code: "" };
    const result = classifyBookingAgainstSet(draft, existing);
    expect(result.matchType).toBe("update");
  });

  it("flags a genuine conflict when a different booking overlaps the same room", () => {
    const existing = [makeBooking({ code: "OTHER" })];
    const draft = { room: 601, checkin: "2026-09-06", checkout: "2026-09-08", code: "DIFFERENT" };
    const result = classifyBookingAgainstSet(draft, existing);
    expect(result.matchType).toBe("conflict");
  });

  it("never lets an import silently overwrite a booking still pending approval", () => {
    const existing = [makeBooking({ code: "BDC1", approvalStatus: "pending" })];
    const draft = { room: 601, checkin: "2026-09-05", checkout: "2026-09-07", code: "BDC1" };
    const result = classifyBookingAgainstSet(draft, existing);
    expect(result.matchType).not.toBe("update");
  });
});
