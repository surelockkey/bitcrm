import { describe, expect, it } from "vitest";
import { formatUsDay, formatWzDay, formatWzDayRange, ordinal, parseUsDay } from "./dates";

/**
 * Workiz writes days the moment.js way, "Oct 8th, 2026" — the date-range box
 * on every list page ("Oct 8th, 2026 - Oct 8th, 2026", callspage_wz_01_today)
 * and the call log's Time column ("Thu Oct 8th, 3:15PM").
 */
describe("ordinal", () => {
  it.each([
    [1, "1st"],
    [2, "2nd"],
    [3, "3rd"],
    [4, "4th"],
    [11, "11th"],
    [12, "12th"],
    [13, "13th"],
    [21, "21st"],
    [22, "22nd"],
    [23, "23rd"],
    [30, "30th"],
    [31, "31st"],
  ])("%i → %s", (n, text) => {
    expect(ordinal(n)).toBe(text);
  });
});

describe("formatWzDay", () => {
  it("writes an account day as Workiz's date-range box does", () => {
    expect(formatWzDay("2026-10-08")).toBe("Oct 8th, 2026");
    expect(formatWzDay("2026-09-01")).toBe("Sep 1st, 2026");
    expect(formatWzDay("2025-12-31")).toBe("Dec 31st, 2025");
  });

  it("returns nothing for a value that is not a day", () => {
    expect(formatWzDay("")).toBe("");
    expect(formatWzDay("10/08/2026")).toBe("");
  });
});

describe("formatWzDayRange", () => {
  it("joins both ends with a spaced hyphen, the same day twice included", () => {
    expect(formatWzDayRange("2026-10-08", "2026-10-08")).toBe("Oct 8th, 2026 - Oct 8th, 2026");
    expect(formatWzDayRange("2026-09-27", "2026-10-03")).toBe("Sep 27th, 2026 - Oct 3rd, 2026");
  });
});

/** The date box's Custom inputs (callspage_wz_06_date_custom): "10/08/2026". */
describe("formatUsDay / parseUsDay", () => {
  it("writes an account day as MM/DD/YYYY", () => {
    expect(formatUsDay("2026-10-08")).toBe("10/08/2026");
    expect(formatUsDay("nope")).toBe("");
  });

  it("reads MM/DD/YYYY back, with or without leading zeros", () => {
    expect(parseUsDay("10/08/2026")).toBe("2026-10-08");
    expect(parseUsDay("1/5/2026")).toBe("2026-01-05");
    expect(parseUsDay(" 12/31/2025 ")).toBe("2025-12-31");
  });

  it("refuses what is not a real day", () => {
    expect(parseUsDay("")).toBeNull();
    expect(parseUsDay("13/01/2026")).toBeNull();
    expect(parseUsDay("02/30/2026")).toBeNull();
    expect(parseUsDay("2026-10-08")).toBeNull();
  });
});
