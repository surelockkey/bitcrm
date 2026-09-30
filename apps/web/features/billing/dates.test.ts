import { describe, expect, it } from "vitest";
import { addDaysYmd, formatYmd, isYmd, todayYmd, ymdOf } from "./dates";

describe("billing dates", () => {
  it("validates YYYY-MM-DD", () => {
    expect(isYmd("2026-09-16")).toBe(true);
    expect(isYmd("2026-9-16")).toBe(false);
    expect(isYmd("2026-02-30")).toBe(false);
    expect(isYmd(undefined)).toBe(false);
  });

  it("adds days across month and year boundaries", () => {
    expect(addDaysYmd("2026-09-16", 0)).toBe("2026-09-16");
    expect(addDaysYmd("2026-09-16", 15)).toBe("2026-10-01");
    expect(addDaysYmd("2026-12-20", 30)).toBe("2027-01-19");
    expect(addDaysYmd("2028-02-28", 1)).toBe("2028-02-29");
  });

  it("formats a day without shifting it through UTC", () => {
    expect(formatYmd("2026-09-01")).toBe("Sep 1, 2026");
    expect(formatYmd("")).toBe("—");
    expect(formatYmd(undefined)).toBe("—");
  });

  it("formats an ISO instant as its date", () => {
    expect(formatYmd("2026-09-01T10:00:00.000Z")).toMatch(/Sep \d, 2026/);
  });

  it("gives today's local day key", () => {
    const d = new Date(2026, 8, 16, 23, 30);
    expect(todayYmd(d)).toBe("2026-09-16");
    expect(ymdOf(d)).toBe("2026-09-16");
  });
});
