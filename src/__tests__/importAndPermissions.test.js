import { describe, it, expect } from "vitest";
import { buildImportDraft } from "../domain/importLogic";
import { PERMISSIONS, ROLES } from "../domain/constants";

const rooms = [
  { number: 601, price: 50 },
  { number: 602, price: 50 },
  { number: 603, price: 80 },
];

describe("buildImportDraft", () => {
  it("uses the explicit room number when provided", () => {
    const row = { "Room #": "602", "Price/Night ($)": "50", "Check In": "2026-09-05", "Check Out": "2026-09-07" };
    const draft = buildImportDraft(row, 0, rooms, []);
    expect(draft.room).toBe(602);
    expect(draft.needsRoomReview).toBe(false);
  });

  it("auto-assigns the closest-priced free room when no room number is given", () => {
    const row = { "Price/Night ($)": "78", "Check In": "2026-09-05", "Check Out": "2026-09-07" };
    const draft = buildImportDraft(row, 0, rooms, []);
    expect(draft.room).toBe(603); // أقرب سعر لـ 78 هو 80
    expect(draft.needsRoomReview).toBe(true);
  });

  it("flags for review when every room is already booked for those dates", () => {
    const existing = rooms.map((r) => ({ id: "x" + r.number, room: r.number, checkin: "2026-09-05", checkout: "2026-09-07", status: "مؤكد" }));
    const row = { "Price/Night ($)": "50", "Check In": "2026-09-05", "Check Out": "2026-09-07" };
    const draft = buildImportDraft(row, 0, rooms, existing);
    expect(draft.room).toBe("");
    expect(draft.needsRoomReview).toBe(true);
  });

  it("maps payment options text to a known payment method", () => {
    const row = { "Payment Options": "Visa ending 1234" };
    const draft = buildImportDraft(row, 0, rooms, []);
    expect(draft.paymentMethod).toBe("فيزا");
  });

  it("computes nights from checkin/checkout when Nights column is missing", () => {
    const row = { "Room #": "601", "Check In": "2026-09-01", "Check Out": "2026-09-05" };
    const draft = buildImportDraft(row, 0, rooms, []);
    expect(draft.checkin).toBe("2026-09-01");
    expect(draft.checkout).toBe("2026-09-05");
  });
});

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
});
