import { describe, it, expect, beforeEach } from "vitest";
import { setActiveHotelId, getActiveHotelId, resolveHotelScope, DEFAULT_HOTELS } from "../data/hotels";
import { GROUP_NAME } from "../domain/constants";

describe("الفنادق المتعددة - الفندق الشغال ونطاق القراءة", () => {
  beforeEach(() => setActiveHotelId(1));
  it("الافتراضي هو الفندق الأصلي رقم ١ (Calma)", () => {
    expect(getActiveHotelId()).toBe(1);
    expect(DEFAULT_HOTELS[0].id).toBe(1);
    expect(resolveHotelScope()).toBe(1);
  });
  it("تغيير الفندق الشغال بيغيّر نطاق القراءة الافتراضي", () => {
    setActiveHotelId(3);
    expect(getActiveHotelId()).toBe(3);
    expect(resolveHotelScope()).toBe(3);
    expect(resolveHotelScope(undefined)).toBe(3);
  });
  it("رقم صريح يتجاب كما هو، و\"all\" معناها كل الفنادق (null = من غير فلتر)", () => {
    setActiveHotelId(2);
    expect(resolveHotelScope(4)).toBe(4);
    expect(resolveHotelScope("4")).toBe(4);
    expect(resolveHotelScope("all")).toBeNull();
  });
  it("قيمة غلط ترجع للفندق ١ بدل ما تكسر", () => {
    setActiveHotelId("abc");
    expect(getActiveHotelId()).toBe(1);
    setActiveHotelId(null);
    expect(getActiveHotelId()).toBe(1);
  });
  it("اسم الجروب H&S", () => { expect(GROUP_NAME).toBe("H&S"); });
});
