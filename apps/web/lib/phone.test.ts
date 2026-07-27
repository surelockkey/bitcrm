import { describe, it, expect } from "vitest";
import { normalizePhone, isValidPhone, formatPhone, formatAsYouType, detectInternational, toE164, formatIntl, callingCode } from "./phone";

describe("phone", () => {
  it("normalizes any US input to E.164", () => {
    for (const input of ["4045551234", "(404) 555-1234", "+1 404 555 1234", "14045551234", "404.555.1234"]) {
      expect(normalizePhone(input)).toBe("+14045551234");
    }
  });

  it("parses an international number by its + prefix", () => {
    expect(normalizePhone("+44 20 7946 0000")).toBe("+442079460000");
  });

  it("rejects invalid or empty input", () => {
    expect(normalizePhone("555")).toBeNull();
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone("abc")).toBeNull();
    expect(isValidPhone("123")).toBe(false);
    expect(isValidPhone("4045551234")).toBe(true);
  });

  it("formats every valid number the same way — country code + national grouping", () => {
    expect(formatPhone("4045551234")).toBe("+1 (404) 555-1234");
    expect(formatPhone("+14045551234")).toBe("+1 (404) 555-1234");
    expect(formatPhone("(404) 555-1234")).toBe("+1 (404) 555-1234");
    expect(formatPhone("+442079460000")).toBe("+44 020 7946 0000");
  });

  it("passes unparseable input through formatPhone unchanged", () => {
    expect(formatPhone("")).toBe("");
    expect(formatPhone("call me")).toBe("call me");
  });

  it("groups digits as you type", () => {
    expect(formatAsYouType("404555")).toBe("(404) 555");
  });

  it("combines a country + national digits into E.164", () => {
    expect(toE164("US", "(404) 555-1234")).toBe("+14045551234");
    expect(toE164("GB", "20 7946 0000")).toBe("+442079460000");
    expect(toE164("US", "")).toBe("");
  });

  it("formats a whole international number in one field", () => {
    expect(formatIntl("+380958601427")).toBe("+380 95 860 1427");
    expect(formatIntl("14045551234")).toBe("+1 404 555 1234");
    expect(formatIntl("")).toBe("");
    expect(callingCode("US")).toBe("1");
    expect(callingCode("UA")).toBe("380");
  });

  it("detects the country when a + country code is entered, and splits the national part", () => {
    expect(detectInternational("4045551234")).toBeNull(); // plain national → no detection
    expect(detectInternational("+14045551234")).toEqual({ country: "US", national: "(404) 555-1234" });
    const gb = detectInternational("+442079460000");
    expect(gb?.country).toBe("GB");
  });
});
