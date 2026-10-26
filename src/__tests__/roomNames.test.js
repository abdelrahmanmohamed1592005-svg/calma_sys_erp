import { describe, it, expect } from "vitest";
import { roomNameParts, roomDisplay, roomLabel, ROOMS_DEFAULT } from "../domain/constants";

/* أسامي الغرف بتتعرض دايمًا: الرقم ← الأكواد ← الكلمة العربي، مهما كان شكلها المتسجّل */
describe("أسامي الغرف", () => {
  it("بيفكّ الأشكال المختلفة لنفس الترتيب", () => {
    expect(roomNameParts("(W)606(T)", 606)).toEqual({ num: "606", codes: ["T", "W"], word: "" });
    expect(roomNameParts("(t)601داخلي", 601)).toEqual({ num: "601", codes: ["t"], word: "داخلي" });
    expect(roomNameParts("602(S/D)داخلي", 602)).toEqual({ num: "602", codes: ["S/D"], word: "داخلي" });
    expect(roomNameParts("", 700)).toEqual({ num: "700", codes: [], word: "" });
    expect(roomNameParts("جناح ملكي", 701)).toEqual({ num: "701", codes: [], word: "جناح ملكي" });
  });
  it("كل الغرف الافتراضية بتبدأ برقمها", () => {
    for (const r of ROOMS_DEFAULT) expect(roomDisplay(ROOMS_DEFAULT, r.number).ltr.startsWith(String(r.number))).toBe(true);
  });
  it("التسمية الكاملة: الجزء اللاتيني معزول عشان مايتقلبش في الجملة العربي", () => {
    expect(roomLabel(ROOMS_DEFAULT, 606)).toBe("غرفة ⁦606 (T)(W)⁩");
    expect(roomLabel(ROOMS_DEFAULT, 601)).toBe("غرفة ⁦601 (t)⁩ داخلي");
    expect(roomLabel([], 999)).toBe("غرفة ⁦999⁩");
  });
});
