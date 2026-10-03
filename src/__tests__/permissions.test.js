import { describe, it, expect } from "vitest";
import { PERMISSIONS, ROLES } from "../domain/constants";

describe("permission matrix sanity", () => {
  it("defines permissions for every role", () => {
    ROLES.forEach((r) => expect(PERMISSIONS[r.key]).toBeDefined());
  });

  it("only staff and reservations can create bookings", () => {
    expect(PERMISSIONS.staff.canCreateBookings).toBe(true);
    expect(PERMISSIONS.reservations.canCreateBookings).toBe(true);
    expect(PERMISSIONS.accounts.canCreateBookings).toBe(false);
    expect(PERMISSIONS.gm.canCreateBookings).toBe(false);
  });

  it("only the GM can manage user accounts", () => {
    ROLES.forEach((r) => {
      if (r.key === "gm") expect(PERMISSIONS.gm.manageUsers).toBe(true);
      else expect(PERMISSIONS[r.key].manageUsers).toBe(false);
    });
  });

  it("the GM cannot directly edit operational data (view-only by design)", () => {
    expect(PERMISSIONS.gm.editLedger).toBe(false);
    expect(PERMISSIONS.gm.editBookings).toBe(false);
    expect(PERMISSIONS.gm.editRoomStatus).toBe(false);
  });

  it("only staff has the occupied-room status restriction", () => {
    expect(PERMISSIONS.staff.roomStatusRestricted).toBe(true);
    expect(PERMISSIONS.reservations.roomStatusRestricted).toBe(false);
  });

  // مدير الحجوزات يضيف الحجوزات ويحدد سعرها، لكن "استلمنا الفلوس فعليًا
  // ولا لأ" قرار موظف الشيفت بس - لو رجع markPaymentReceived يتفعّل لمدير
  // الحجوزات تاني، اختبار ده هيفشل وينبّه إن حد رجّع الصلاحية دي بالغلط.
  it("only staff can mark a booking's payment as collected", () => {
    expect(PERMISSIONS.staff.markPaymentReceived).toBe(true);
    expect(PERMISSIONS.reservations.markPaymentReceived).toBe(false);
    expect(PERMISSIONS.accounts.markPaymentReceived).toBe(false);
    expect(PERMISSIONS.gm.markPaymentReceived).toBe(false);
  });
});
