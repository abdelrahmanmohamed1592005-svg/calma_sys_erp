import { describe, it, expect } from "vitest";
import { validatePasswordStrength, validateUsername, sanitizeText } from "../domain/security";

describe("validatePasswordStrength", () => {
  it("rejects short passwords", () => {
    expect(validatePasswordStrength("abc123").ok).toBe(false);
  });
  it("rejects passwords with no digit", () => {
    expect(validatePasswordStrength("abcdefgh").ok).toBe(false);
  });
  it("rejects passwords with no letter", () => {
    expect(validatePasswordStrength("12345678").ok).toBe(false);
  });
  it("accepts a valid password", () => {
    expect(validatePasswordStrength("abcd1234").ok).toBe(true);
  });
  it("handles empty/undefined input safely", () => {
    expect(validatePasswordStrength(undefined).ok).toBe(false);
    expect(validatePasswordStrength("").ok).toBe(false);
  });
});

describe("validateUsername", () => {
  it("rejects usernames that are too short", () => {
    expect(validateUsername("ab").ok).toBe(false);
  });
  it("rejects usernames with spaces or symbols", () => {
    expect(validateUsername("ahmed hassan").ok).toBe(false);
    expect(validateUsername("ahmed@hassan").ok).toBe(false);
    expect(validateUsername("ahmed-hassan").ok).toBe(false);
  });
  it("accepts a normal username", () => {
    expect(validateUsername("ahmed_1").ok).toBe(true);
  });
  it("is case-insensitive (normalizes to lowercase)", () => {
    expect(validateUsername("Ahmed123").ok).toBe(true);
  });
});

describe("sanitizeText", () => {
  it("strips control characters", () => {
    expect(sanitizeText("hello\u0000world")).toBe("helloworld");
  });
  it("trims whitespace", () => {
    expect(sanitizeText("  hello  ")).toBe("hello");
  });
  it("caps length to the given max", () => {
    expect(sanitizeText("a".repeat(500), 10)).toBe("a".repeat(10));
  });
  it("handles null/undefined safely", () => {
    expect(sanitizeText(null)).toBe("");
    expect(sanitizeText(undefined)).toBe("");
  });
  it("does not corrupt normal Arabic text", () => {
    expect(sanitizeText("أحمد حسن")).toBe("أحمد حسن");
  });
});
