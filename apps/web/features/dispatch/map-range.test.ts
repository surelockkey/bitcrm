import { describe, expect, it } from "vitest";

import { localToday, mapRangeLabel, mapRangeWindow, shiftMapRange } from "./map-range";

// Friday 9 October 2026 — the day the Workiz captures were taken.
const FRI = "2026-10-09";

describe("mapRangeWindow", () => {
  it("Day is the one day", () => {
    expect(mapRangeWindow("day", FRI)).toEqual({ from: FRI, to: FRI });
  });

  it("Week runs Sunday to Saturday, as Workiz's does", () => {
    expect(mapRangeWindow("week", FRI)).toEqual({ from: "2026-10-04", to: "2026-10-10" });
    // A Sunday starts its own week; a Saturday ends it.
    expect(mapRangeWindow("week", "2026-10-04")).toEqual({ from: "2026-10-04", to: "2026-10-10" });
    expect(mapRangeWindow("week", "2026-10-10")).toEqual({ from: "2026-10-04", to: "2026-10-10" });
  });

  it("Month is the calendar month", () => {
    expect(mapRangeWindow("month", FRI)).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(mapRangeWindow("month", "2028-02-10")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
  });

  it("a week across the year's end", () => {
    expect(mapRangeWindow("week", "2026-12-31")).toEqual({ from: "2026-12-27", to: "2027-01-02" });
  });
});

describe("shiftMapRange", () => {
  it("steps a day, a week or a month at a time", () => {
    expect(shiftMapRange("day", FRI, 1)).toBe("2026-10-10");
    expect(shiftMapRange("day", "2026-10-01", -1)).toBe("2026-09-30");
    expect(shiftMapRange("week", FRI, 1)).toBe("2026-10-16");
    expect(shiftMapRange("week", FRI, -1)).toBe("2026-10-02");
  });

  it("steps months from their first day, so the 31st never skips one", () => {
    expect(shiftMapRange("month", "2026-01-31", 1)).toBe("2026-02-01");
    expect(shiftMapRange("month", "2026-01-15", -1)).toBe("2025-12-01");
  });

  // pg_dispatch_wz_15_next3: three › from the week of Oct 4 is Oct 25 – 31.
  it("three weeks on from the capture's week is Oct 25 – Oct 31", () => {
    let anchor = FRI;
    for (let i = 0; i < 3; i++) anchor = shiftMapRange("week", anchor, 1);
    expect(mapRangeWindow("week", anchor)).toEqual({ from: "2026-10-25", to: "2026-10-31" });
  });
});

describe("mapRangeLabel", () => {
  // The words of pg_dispatch_wz_14_range_{day,week,month}.
  it("prints the days the way the Workiz date box does", () => {
    expect(mapRangeLabel("day", FRI)).toEqual(["Fri, Oct 9, 2026"]);
    expect(mapRangeLabel("week", FRI)).toEqual(["Sun, Oct 4, 2026 - ", "Sat, Oct 10, 2026"]);
    expect(mapRangeLabel("month", FRI)).toEqual(["Thu, Oct 1, 2026 - ", "Sat, Oct 31, 2026"]);
  });
});

describe("localToday", () => {
  // Workiz's date box follows the viewer's clock, not UTC: late evening in
  // the US is already tomorrow in UTC.
  it("is the viewer's own calendar day", () => {
    expect(localToday(new Date(2026, 9, 9, 23, 30))).toBe("2026-10-09");
    expect(localToday(new Date(2026, 0, 1, 0, 5))).toBe("2026-01-01");
  });
});
