import { describe, it, expect } from "vitest";
import { addDays, nightsBetween, parseDateFlexible, nextShiftOf, prevShiftOf, isSameDay, isShiftActiveNow, shiftDayNow } from "../domain/dates";

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

describe("isShiftActiveNow (overtime grace window)", () => {
  it("is active during the normal morning window", () => {
    expect(isShiftActiveNow("morning", 2, new Date(2026, 8, 5, 10, 0))).toBe(true);
  });
  it("is still active in the first minute of overtime after the morning shift ends (16:00)", () => {
    expect(isShiftActiveNow("morning", 2, new Date(2026, 8, 5, 16, 1))).toBe(true);
  });
  it("is no longer active once the overtime grace period has fully elapsed (18:01)", () => {
    expect(isShiftActiveNow("morning", 2, new Date(2026, 8, 5, 18, 1))).toBe(false);
  });
  it("handles the evening shift's overtime correctly past midnight (01:00 next day)", () => {
    expect(isShiftActiveNow("evening", 2, new Date(2026, 8, 6, 1, 0))).toBe(true);
  });
  it("evening shift is no longer active once well past its overtime window (03:00)", () => {
    expect(isShiftActiveNow("evening", 2, new Date(2026, 8, 6, 3, 0))).toBe(false);
  });
  it("night shift overtime extends a couple hours past 08:00", () => {
    expect(isShiftActiveNow("night", 2, new Date(2026, 8, 5, 9, 30))).toBe(true);
    expect(isShiftActiveNow("night", 2, new Date(2026, 8, 5, 10, 1))).toBe(false);
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

describe("shiftDayNow (operational shift day starts at 08:00)", () => {
  it("after 08:00 it is the calendar day", () => {
    expect(shiftDayNow(new Date(2026, 9, 6, 8, 0))).toBe("2026-10-06");
    expect(shiftDayNow(new Date(2026, 9, 6, 23, 59))).toBe("2026-10-06");
  });
  it("00:00-07:59 still belongs to the previous shift day (evening overtime / night shift)", () => {
    expect(shiftDayNow(new Date(2026, 9, 7, 0, 30))).toBe("2026-10-06");
    expect(shiftDayNow(new Date(2026, 9, 7, 7, 59))).toBe("2026-10-06");
  });
  it("rolls back across a month boundary", () => {
    expect(shiftDayNow(new Date(2026, 10, 1, 1, 0))).toBe("2026-10-31");
  });
});

/* ليلة تغيير الساعة في مصر (نهاية التوقيت الصيفي: ليلة الخميس 29 أكتوبر 2026 الساعة بترجع ساعة) -
   اليوم ده طوله 25 ساعة. الحساب بالتقويم لازم يفضل صح: عدد الليالي وإضافة الأيام ويوم الشيفت. */
describe("ليلة تغيير الساعة (توقيت القاهرة)", () => {
  const withCairo = (fn) => { const old = process.env.TZ; process.env.TZ = "Africa/Cairo"; try { fn(); } finally { if (old === undefined) delete process.env.TZ; else process.env.TZ = old; } };
  it("عدد الليالي والأيام عبر ليلة تغيير الساعة", () => withCairo(() => {
    expect(nightsBetween("2026-10-29", "2026-10-30")).toBe(1);
    expect(nightsBetween("2026-10-28", "2026-10-31")).toBe(3);
    expect(nightsBetween("2026-04-29", "2026-05-02")).toBe(3);   // بداية التوقيت الصيفي (يوم 23 ساعة)
    expect(addDays("2026-10-26", 4)).toBe("2026-10-30");
    expect(addDays("2026-10-30", -1)).toBe("2026-10-29");
  }));
  it("يوم الشيفت بعد نص الليل في الأسبوع ده لسه اليوم اللي قبله", () => withCairo(() => {
    expect(shiftDayNow(new Date("2026-10-26T00:30:00+03:00"))).toBe("2026-10-25");
    expect(shiftDayNow(new Date("2026-10-30T00:30:00+02:00"))).toBe("2026-10-29");
    expect(shiftDayNow(new Date("2026-10-30T09:00:00+02:00"))).toBe("2026-10-30");
  }));
});

import { computeRoomStatus } from "../domain/bookingLogic";
describe("معاد الخروج 12 الضهر في لوحة الغرف", () => {
  const out = { id: "a", room: 601, guestName: "Leaving", checkin: "2026-10-25", checkout: "2026-10-27", status: "مؤكد", totalRoom: 200, amountPaid: 200, extras: {}, paymentDetails: {} };
  const inn = { id: "b", room: 601, guestName: "Arriving", checkin: "2026-10-27", checkout: "2026-10-29", status: "مؤكد", totalRoom: 200, amountPaid: 0, extras: {}, paymentDetails: {} };
  it("قبل 12: النزيل اللي خروجه النهارده لسه في الغرفة (حتى لو فيه حد داخل النهارده)", () => {
    const st = computeRoomStatus(601, [out, inn], {}, "2026-10-27", { beforeCheckout: true });
    expect(st.guest).toBe("Leaving");
    expect(st.departingToday).toBe(true);
  });
  it("بعد 12: الغرفة للنزيل الجديد، ولو مفيش جديد بتبقى متاحة", () => {
    expect(computeRoomStatus(601, [out, inn], {}, "2026-10-27", { beforeCheckout: false }).guest).toBe("Arriving");
    expect(computeRoomStatus(601, [out], {}, "2026-10-27", { beforeCheckout: false }).key).toBe("available");
  });
  it("اللي غادر مبكرًا أو اتسجّل خروجه مابيتحسبش ساكن قبل 12", () => {
    expect(computeRoomStatus(601, [{ ...out, leftEarly: true }], {}, "2026-10-27", { beforeCheckout: true }).key).not.toMatch(/occupied/);
    expect(computeRoomStatus(601, [{ ...out, status: "تم تسجيل الخروج" }], {}, "2026-10-27", { beforeCheckout: true }).key).toBe("available");
  });
});
