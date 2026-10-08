import { describe, expect, it } from "vitest";
import { formatWzDay, formatWzDayRange, ordinal } from "./dates";

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
