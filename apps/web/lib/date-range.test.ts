import { describe, it, expect } from "vitest";
import {
  DAY_END,
  DAY_START,
  TIME_OPTIONS,
  formatRangeLabel,
  formatTime12,
  monthCells,
  parseTimeInput,
  presetRange,
  shiftMonth,
  toDateKey,
  toIsoInstant,
  toLocalParts,
} from "./date-range";

/* These stay timezone-agnostic: local day/time goes in, the same local
   day/time comes back out — never a hard-coded UTC string. */

describe("local ⇄ instant round-trip", () => {
  it("preserves the day and time the user picked", () => {
    expect(toLocalParts(toIsoInstant("2026-08-10", "09:15"))).toEqual({
      date: "2026-08-10",
      time: "09:15",
    });
    expect(toLocalParts(toIsoInstant("2026-01-01", DAY_START))).toEqual({
      date: "2026-01-01",
      time: DAY_START,
    });
    expect(toLocalParts(toIsoInstant("2026-12-31", DAY_END))).toEqual({
      date: "2026-12-31",
      time: DAY_END,
    });
  });

  it("emits a UTC instant, and dashes bad input", () => {
    expect(toIsoInstant("2026-08-10", "09:15")).toMatch(/Z$/);
    expect(toLocalParts(undefined)).toBeUndefined();
    expect(toLocalParts("garbage")).toBeUndefined();
  });
});

describe("formatTime12", () => {
  it("renders 12-hour clock times", () => {
    expect(formatTime12("00:00")).toBe("12:00 AM");
    expect(formatTime12("09:05")).toBe("9:05 AM");
    expect(formatTime12("12:30")).toBe("12:30 PM");
    expect(formatTime12("23:59")).toBe("11:59 PM");
  });
});

describe("parseTimeInput", () => {
  it("accepts the shapes people actually type", () => {
    expect(parseTimeInput("9")).toBe("09:00");
    expect(parseTimeInput("9:30")).toBe("09:30");
    expect(parseTimeInput("9:3")).toBe("09:03");
    expect(parseTimeInput("930")).toBe("09:30");
    expect(parseTimeInput("0930")).toBe("09:30");
    expect(parseTimeInput("1715")).toBe("17:15");
    expect(parseTimeInput("21:30")).toBe("21:30");
    expect(parseTimeInput(" 9:07 ")).toBe("09:07");
  });

  it("handles am/pm, including the noon and midnight corners", () => {
    expect(parseTimeInput("9pm")).toBe("21:00");
    expect(parseTimeInput("9:30 PM")).toBe("21:30");
    expect(parseTimeInput("9 a.m.")).toBe("09:00");
    expect(parseTimeInput("12am")).toBe("00:00");
    expect(parseTimeInput("12pm")).toBe("12:00");
    expect(parseTimeInput("12:15am")).toBe("00:15");
  });

  it("rejects anything that isn't a time", () => {
    expect(parseTimeInput("")).toBeUndefined();
    expect(parseTimeInput("half nine")).toBeUndefined();
    expect(parseTimeInput("24:00")).toBeUndefined();
    expect(parseTimeInput("9:75")).toBeUndefined();
    expect(parseTimeInput("13pm")).toBeUndefined();
    expect(parseTimeInput("0pm")).toBeUndefined();
  });
});

describe("TIME_OPTIONS", () => {
  it("covers the day in quarter-hours and ends at 23:59", () => {
    expect(TIME_OPTIONS[0]).toBe("00:00");
    expect(TIME_OPTIONS).toContain("13:45");
    expect(TIME_OPTIONS.at(-1)).toBe(DAY_END);
    expect(TIME_OPTIONS).toHaveLength(24 * 4 + 1);
  });
});

describe("formatRangeLabel", () => {
  const now = new Date(2026, 7, 10);
  const at = (date: string, time: string) => toIsoInstant(date, time);

  it("hides the times when both bounds are whole days", () => {
    expect(
      formatRangeLabel(
        { from: at("2026-08-05", DAY_START), to: at("2026-08-08", DAY_END) },
        now,
      ),
    ).toBe("Aug 5 – Aug 8");
  });

  it("shows a single day as one date with a time span", () => {
    expect(
      formatRangeLabel(
        { from: at("2026-08-05", "09:00"), to: at("2026-08-05", "17:00") },
        now,
      ),
    ).toBe("Aug 5 · 9:00 AM – 5:00 PM");
  });

  it("shows both timestamps across days", () => {
    expect(
      formatRangeLabel(
        { from: at("2026-08-05", "09:00"), to: at("2026-08-08", "17:00") },
        now,
      ),
    ).toBe("Aug 5, 9:00 AM – Aug 8, 5:00 PM");
  });

  it("labels open-ended and empty ranges", () => {
    expect(formatRangeLabel({ from: at("2026-08-05", DAY_START) }, now)).toBe(
      "From Aug 5",
    );
    expect(formatRangeLabel({ to: at("2026-08-05", "17:00") }, now)).toBe(
      "Until Aug 5, 5:00 PM",
    );
    expect(formatRangeLabel({}, now)).toBe("Any date");
  });

  it("adds the year for other years", () => {
    expect(formatRangeLabel({ from: at("2025-08-05", DAY_START) }, now)).toBe(
      "From Aug 5, 2025",
    );
  });
});

describe("presetRange", () => {
  const now = new Date(2026, 7, 10, 14, 30); // Mon Aug 10, 2026

  it("spans whole local days", () => {
    const today = presetRange("today", now);
    expect(toLocalParts(today.from)).toEqual({ date: "2026-08-10", time: DAY_START });
    expect(toLocalParts(today.to)).toEqual({ date: "2026-08-10", time: DAY_END });

    expect(toLocalParts(presetRange("yesterday", now).from)?.date).toBe("2026-08-09");
    expect(toLocalParts(presetRange("yesterday", now).to)?.date).toBe("2026-08-09");
    expect(toLocalParts(presetRange("last7", now).from)?.date).toBe("2026-08-04");
    expect(toLocalParts(presetRange("last30", now).from)?.date).toBe("2026-07-12");
    expect(toLocalParts(presetRange("thisMonth", now).from)?.date).toBe("2026-08-01");
  });
});

describe("monthCells", () => {
  it("pads to whole weeks and keeps every day of the month", () => {
    const cells = monthCells(new Date(2026, 7, 1)); // Aug 2026 starts Saturday
    expect(cells.length % 7).toBe(0);
    const days = cells.filter(Boolean) as Date[];
    expect(days).toHaveLength(31);
    expect(toDateKey(days[0])).toBe("2026-08-01");
    expect(toDateKey(days[30])).toBe("2026-08-31");
    // Saturday start → six leading blanks.
    expect(cells.slice(0, 6).every((c) => c === null)).toBe(true);
  });
});

describe("shiftMonth", () => {
  it("moves to the first of the target month, across year ends", () => {
    expect(toDateKey(shiftMonth(new Date(2026, 11, 15), 1))).toBe("2027-01-01");
    expect(toDateKey(shiftMonth(new Date(2026, 0, 15), -1))).toBe("2025-12-01");
  });
});
