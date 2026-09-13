import { describe, it, expect } from "vitest";
import { addDays, nightsBetween, parseDateFlexible, nextShiftOf, prevShiftOf, isSameDay } from "../domain/dates";

describe("addDays", () => {
  it("adds positive days across month boundary", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
  });
  it("subtracts days across year boundary", () => {
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });
});

describe("nightsBetween", () => {
  it("computes correct night count", () => {
    expect(nightsBetween("2026-09-01", "2026-09-05")).toBe(4);
  });
  it("returns 0 for same-day checkin/checkout", () => {
    expect(nightsBetween("2026-09-01", "2026-09-01")).toBe(0);
  });
  it("returns 0 for missing dates", () => {
    expect(nightsBetween(null, "2026-09-01")).toBe(0);
  });
});

describe("parseDateFlexible", () => {
  it("parses ISO format", () => {
    expect(parseDateFlexible("2026-09-05")).toBe("2026-09-05");
  });
  it("parses DD/MM/YYYY format", () => {
    expect(parseDateFlexible("05/09/2026")).toBe("2026-09-05");
  });
  it("returns null for empty input", () => {
    expect(parseDateFlexible("")).toBe(null);
  });
});

describe("shift ordering", () => {
  it("nextShiftOf advances within the same day", () => {
    expect(nextShiftOf("2026-09-05", "morning")).toEqual({ date: "2026-09-05", shiftKey: "evening" });
  });
  it("nextShiftOf rolls over to next day after night", () => {
    expect(nextShiftOf("2026-09-05", "night")).toEqual({ date: "2026-09-06", shiftKey: "morning" });
  });
  it("prevShiftOf rolls back to previous day before morning", () => {
    expect(prevShiftOf("2026-09-05", "morning")).toEqual({ date: "2026-09-04", shiftKey: "night" });
  });
});

describe("isSameDay", () => {
  it("matches a timestamp against its own date string", () => {
    const ts = new Date(2026, 8, 5, 14, 30).getTime();
    expect(isSameDay(ts, "2026-09-05")).toBe(true);
  });
  it("rejects a different date", () => {
    const ts = new Date(2026, 8, 5, 14, 30).getTime();
    expect(isSameDay(ts, "2026-09-06")).toBe(false);
  });
});
