import { describe, expect, it } from "vitest";
import type { TimesheetEntryRow } from "@bitcrm/types";
import {
  DEFAULT_TIMESHEET_PRESET,
  TIMESHEET_PRESETS,
  clockCell,
  clockCsv,
  dollars,
  entriesCsv,
  entriesParams,
  exportParams,
  hhmm,
  mapUrl,
  reportParams,
  sortEntries,
  timesheetPresetRange,
  timesheetsCsv,
  toggleTimesheetFilter,
  type TimesheetReportState,
} from "./lib";

const TODAY = "2026-09-30"; // a Wednesday

describe("Timesheets presets", () => {
  it("opens on This week (Mon-Today), like Workiz", () => {
    expect(DEFAULT_TIMESHEET_PRESET).toBe("this_week_mon");
    expect(timesheetPresetRange("this_week_mon", TODAY)).toEqual({ from: "2026-09-28", to: "2026-09-30" });
  });

  it("offers Workiz's sixteen, Recent last, and no All time", () => {
    expect(TIMESHEET_PRESETS).toHaveLength(16);
    expect(TIMESHEET_PRESETS.at(-1)?.label).toBe("Recent (30 days, including today)");
    expect(TIMESHEET_PRESETS.map((p) => p.label)).not.toContain("All time");
  });

  it("reads Recent as the thirty days that end today", () => {
    expect(timesheetPresetRange("recent", TODAY)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(timesheetPresetRange("this_month", TODAY)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(timesheetPresetRange("last_7", TODAY)).toEqual({ from: "2026-09-23", to: "2026-09-29" });
  });
});

describe("Workiz cells", () => {
  it("prints hours as hh:mm, however many hours", () => {
    expect(hhmm(18293)).toBe("304:53");
    expect(hhmm(1)).toBe("00:01");
    expect(hhmm(0)).toBe("00:00");
    expect(hhmm(undefined)).toBe("00:00");
    expect(hhmm(5769267)).toBe("96154:27");
  });

  it("prints money with two decimals and no separator", () => {
    expect(dollars(6356.67)).toBe("$6356.67");
    expect(dollars(0)).toBe("$0.00");
    expect(dollars(undefined)).toBe("$0.00");
  });

  it("prints a punch on the account's clock, summer and winter", () => {
    expect(clockCell("2026-09-04T17:23:00.000Z")).toBe("Fri Sep 04 2026 01:23 pm");
    expect(clockCell("2026-12-04T17:23:00.000Z")).toBe("Fri Dec 04 2026 12:23 pm");
    expect(clockCell("2026-09-30T04:05:00.000Z")).toBe("Wed Sep 30 2026 12:05 am");
    expect(clockCell(undefined)).toBe("");
  });

  it("writes the export's date as Workiz does", () => {
    expect(clockCsv("2026-09-04T17:23:00.000Z")).toBe("September 4th 2026 1:23 pm");
    expect(clockCsv("2026-09-22T12:00:00.000Z")).toBe("September 22nd 2026 8:00 am");
    expect(clockCsv("2026-09-11T12:00:00.000Z")).toBe("September 11th 2026 8:00 am");
  });

  it("opens a fix on Google Maps", () => {
    expect(mapUrl({ lat: 41.26, lng: -72.94 })).toBe("https://www.google.com/maps/search/?api=1&query=41.26,-72.94");
  });
});

describe("requests", () => {
  const state: TimesheetReportState = {
    from: "2026-09-01",
    to: "2026-09-27",
    filters: { userId: ["u1", "u2"], job: ["with_job"] },
    search: "  ray ",
    sort: "name",
    dir: "desc",
    page: 2,
    pageSize: 10,
  };

  it("sends the period, the filter, the search, the sort and the page", () => {
    expect(Object.fromEntries(new URLSearchParams(reportParams(state)))).toEqual({
      from: "2026-09-01",
      to: "2026-09-27",
      userId: "u1,u2",
      job: "with_job",
      q: "ray",
      sort: "name",
      dir: "desc",
      page: "2",
      pageSize: "10",
    });
  });

  it("exports everything in one page", () => {
    const p = new URLSearchParams(exportParams(state));
    expect(p.get("page")).toBe("1");
    expect(p.get("pageSize")).toBe("1000");
  });

  it("carries the Jobs filter, not the Team, into an opened row", () => {
    expect(Object.fromEntries(new URLSearchParams(entriesParams("u9", state)))).toEqual({
      userId: "u9",
      from: "2026-09-01",
      to: "2026-09-27",
      job: "with_job",
    });
  });

  it("ticks and unticks a filter value", () => {
    const on = toggleTimesheetFilter({}, "job", "with_job");
    expect(on).toEqual({ job: ["with_job"] });
    expect(toggleTimesheetFilter(on, "job", "with_job")).toEqual({});
  });
});

describe("CSV", () => {
  const page = {
    money: true,
    total: { minutes: 18293, grossMinutes: 18293, cost: 6356.67, grossCost: 6356.67, jobs: 38, entries: 73 },
    rows: [
      { userId: "c", name: "Chris Ray", clockedIn: false, minutes: 9535, grossMinutes: 9535, cost: 6356.67, grossCost: 6356.67, jobs: 0, entries: 18 },
      { userId: "y", name: "Yeter, Mizrahi", clockedIn: true, minutes: 8757, grossMinutes: 8758, cost: 0, grossCost: 0, jobs: 34, entries: 50 },
    ],
  };

  it("writes Workiz's columns, the Gross pair included, the Total line first", () => {
    expect(timesheetsCsv(page).split("\n")).toEqual([
      "User,Hours,Cost,Gross Hours,Gross Cost,Jobs",
      "Total:,304:53,$6356.67,304:53,$6356.67,38",
      "Chris Ray,158:55,$6356.67,158:55,$6356.67,0",
      '"Yeter, Mizrahi",145:57,$0.00,145:58,$0.00,34',
    ]);
  });

  it("leaves the money columns out without financials", () => {
    expect(timesheetsCsv({ ...page, money: false }).split("\n")[0]).toBe("User,Hours,Gross Hours,Jobs");
  });

  const entry = (over: Partial<TimesheetEntryRow>): TimesheetEntryRow => ({
    id: "e",
    userId: "y",
    startedAt: "2026-09-29T16:34:00.000Z",
    endedAt: "2026-09-29T22:46:00.000Z",
    open: false,
    minutes: 372,
    cost: 0,
    source: "mobile",
    ...over,
  });

  it("writes an opened row with its Total and Gross Total", () => {
    const rows = [entry({ dealId: "d1", notes: "Forgot to clock out" }), entry({ id: "o", startedAt: "2026-09-29T22:59:00.000Z", endedAt: undefined, open: true, minutes: 0 })];
    const out = entriesCsv(
      { name: "Yeter Mizrahi", money: true, rows, total: { minutes: 372, grossMinutes: 372, cost: 0, grossCost: 0 } },
      rows,
      new Map([["d1", { number: "ONW3G7" }]]),
    ).split("\n");
    expect(out[0]).toBe("User,Clock in,Clock out,Hours,Cost,Job,Job name,Notes");
    expect(out[1]).toBe("Yeter Mizrahi,September 29th 2026 12:34 pm,September 29th 2026 6:46 pm,06:12,$0.00,ONW3G7,,Forgot to clock out");
    expect(out[2]).toBe("Yeter Mizrahi,September 29th 2026 6:59 pm,,00:00,$0.00,,,");
    expect(out.slice(-2)).toEqual(["Total,,,06:12,$0.00,,,", "Gross Total,,,06:12,$0.00,,,"]);
  });

  it("sorts an opened row by start, newest first, or by a column", () => {
    const rows = [
      entry({ id: "a", startedAt: "2026-09-01T10:00:00.000Z", minutes: 30, dealId: "d2" }),
      entry({ id: "b", startedAt: "2026-09-03T10:00:00.000Z", minutes: 10, dealId: "d1" }),
      entry({ id: "c", startedAt: "2026-09-02T10:00:00.000Z", minutes: 20 }),
    ];
    const jobs = new Map([
      ["d1", { number: "AAA111" }],
      ["d2", { number: "ZZZ999" }],
    ]);
    expect(sortEntries(rows, "start", "desc", jobs).map((r) => r.id)).toEqual(["b", "c", "a"]);
    expect(sortEntries(rows, "hours", "asc", jobs).map((r) => r.id)).toEqual(["b", "c", "a"]);
    expect(sortEntries(rows, "job", "desc", jobs).map((r) => r.id)).toEqual(["a", "b", "c"]);
  });
});
