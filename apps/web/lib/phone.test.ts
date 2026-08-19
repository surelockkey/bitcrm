import { describe, it, expect } from "vitest";
import {
  normalizePhone,
  isValidPhone,
  formatPhone,
  formatAsYouType,
  nationalInput,
  toE164,
  callingCode,
} from "./phone";

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

  it("formats US numbers nationally — no +1 anywhere on the site", () => {
    expect(formatPhone("4045551234")).toBe("(404) 555-1234");
    expect(formatPhone("+14045551234")).toBe("(404) 555-1234");
    expect(formatPhone("14045551234")).toBe("(404) 555-1234");
    expect(formatPhone("(404) 555-1234")).toBe("(404) 555-1234");
  });

  it("keeps the country code on non-US numbers, without the trunk prefix", () => {
    expect(formatPhone("+442079460000")).toBe("+44 20 7946 0000");
    expect(formatPhone("+380958601427")).toBe("+380 95 860 1427");
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
    expect(callingCode("US")).toBe("1");
    expect(callingCode("UA")).toBe("380");
  });

  describe("nationalInput — what typed/pasted text means in the selected country", () => {
    it("keeps plain national digits as typed", () => {
      expect(nationalInput("4045551234", "US")).toBe("4045551234");
      expect(nationalInput("(404) 555-1234", "US")).toBe("4045551234");
      expect(nationalInput("404555", "US")).toBe("404555"); // still typing
    });

    it("strips the country's dial code from a pasted number", () => {
      expect(nationalInput("+14045551234", "US")).toBe("4045551234");
      expect(nationalInput("+1 (404) 555-1234", "US")).toBe("4045551234");
      expect(nationalInput("14045551234", "US")).toBe("4045551234"); // 11-digit paste, no +
    });

    it("strips an explicit +code even while the number is incomplete", () => {
      expect(nationalInput("+1404", "US")).toBe("404");
    });

    it("strips the national trunk prefix in countries that have one", () => {
      expect(nationalInput("0958601427", "UA")).toBe("958601427");
    });

    it("never switches the country — a foreign +code is just digits here", () => {
      expect(nationalInput("+442079460000", "US")).toBe("442079460000");
    });

    it("returns empty for empty or digitless input", () => {
      expect(nationalInput("", "US")).toBe("");
      expect(nationalInput("+", "US")).toBe("");
    });
  });
});
