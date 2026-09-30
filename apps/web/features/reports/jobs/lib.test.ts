import { describe, expect, it } from "vitest";
import {
  JOBS_REPORT_PRESETS,
  accountToday,
  accountWall,
  addFilter,
  exportParams,
  filterCount,
  inReportOrder,
  presetRange,
  reportParams,
  toggleFilter,
  workizDate,
  type JobsReportState,
} from "./lib";

const state = (over: Partial<JobsReportState> = {}): JobsReportState => ({
  by: "end",
  from: "2026-09-01",
  to: "2026-09-27",
  filters: {},
  search: "",
  sort: "created",
  dir: "desc",
  page: 1,
  pageSize: 50,
  ...over,
});

describe("jobs report — presets", () => {
  // Tuesday 2026-09-29, the day Workiz was read live.
  const today = "2026-09-29";

  it("lists Workiz's fifteen presets in its order", () => {
    expect(JOBS_REPORT_PRESETS.map((p) => p.label)).toEqual([
      "Custom",
      "Today",
      "Yesterday",
      "Last 7 days",
      "Last 14 days",
      "Last 30 days",
      "Last month",
      "This month",
      "This year",
      "Last year",
      "This week (Sun-Today)",
      "This week (Mon-Today)",
      "Last week (Sun-Sat)",
      "Last week (Mon-Sun)",
      "Last business week (Mon-Fri)",
    ]);
  });

  it("counts like Workiz — 'Last 7 days' ends yesterday", () => {
    expect(presetRange("today", today)).toEqual({ from: today, to: today });
    expect(presetRange("yesterday", today)).toEqual({ from: "2026-09-28", to: "2026-09-28" });
    expect(presetRange("last_7", today)).toEqual({ from: "2026-09-22", to: "2026-09-28" });
    expect(presetRange("last_14", today)).toEqual({ from: "2026-09-15", to: "2026-09-28" });
    expect(presetRange("last_30", today)).toEqual({ from: "2026-08-30", to: "2026-09-28" });
    expect(presetRange("last_month", today)).toEqual({ from: "2026-08-01", to: "2026-08-31" });
    expect(presetRange("this_month", today)).toEqual({ from: "2026-09-01", to: today });
    expect(presetRange("this_year", today)).toEqual({ from: "2026-01-01", to: today });
    expect(presetRange("last_year", today)).toEqual({ from: "2025-01-01", to: "2025-12-31" });
  });

  it("knows both kinds of week", () => {
    expect(presetRange("this_week_sun", today)).toEqual({ from: "2026-09-27", to: today });
    expect(presetRange("this_week_mon", today)).toEqual({ from: "2026-09-28", to: today });
    expect(presetRange("last_week_sun", today)).toEqual({ from: "2026-09-20", to: "2026-09-26" });
    expect(presetRange("last_week_mon", today)).toEqual({ from: "2026-09-21", to: "2026-09-27" });
    expect(presetRange("last_business_week", today)).toEqual({ from: "2026-09-21", to: "2026-09-25" });
    // A Sunday belongs to the Monday week that is ending.
    expect(presetRange("this_week_mon", "2026-10-04")).toEqual({ from: "2026-09-28", to: "2026-10-04" });
    expect(presetRange("this_week_sun", "2026-10-04")).toEqual({ from: "2026-10-04", to: "2026-10-04" });
  });

  it("takes today off the Eastern calendar", () => {
    // 02:30 UTC on the 30th is still the 29th in New York.
    expect(accountToday(new Date("2026-09-30T02:30:00Z"))).toBe("2026-09-29");
  });
});

describe("jobs report — the request", () => {
  it("sends the period, the multi-filter, the search, the sort and the page", () => {
    const p = new URLSearchParams(
      reportParams(state({ filters: { status: ["done", "canceled:s1"], techId: ["u1"] }, search: " smith ", page: 3, pageSize: 100 })),
    );
    expect(Object.fromEntries(p)).toEqual({
      by: "end",
      from: "2026-09-01",
      to: "2026-09-27",
      status: "done,canceled:s1",
      techId: "u1",
      q: "smith",
      sort: "created",
      dir: "desc",
      page: "3",
      pageSize: "100",
    });
  });

  it("exports the same query with the visible columns and no paging", () => {
    const p = new URLSearchParams(exportParams(state({ page: 4 }), ["jobNumber", "total"]));
    expect(p.get("columns")).toBe("jobNumber,total");
    expect(p.has("page")).toBe(false);
    expect(p.get("by")).toBe("end");
  });

  it("ticks, unticks and adds filter values", () => {
    let f = toggleFilter({}, "tagId", "t1");
    expect(f).toEqual({ tagId: ["t1"] });
    f = toggleFilter(f, "tagId", "t2");
    expect(filterCount(f)).toBe(2);
    expect(toggleFilter(toggleFilter(f, "tagId", "t1"), "tagId", "t2")).toEqual({});
    expect(addFilter(f, "tagId", "t1")).toBe(f);
    expect(addFilter(f, "jobTypeId", "jt")).toEqual({ tagId: ["t1", "t2"], jobTypeId: ["jt"] });
  });

  it("keeps columns in the report order", () => {
    expect(inReportOrder(["total", "client", "jobNumber"])).toEqual(["jobNumber", "client", "total"]);
  });
});

describe("jobs report — cells", () => {
  it("prints dates as Workiz does, on the Eastern clock", () => {
    expect(workizDate("2026-09-29T14:35")).toBe("Tue Sep 29, 2026 02:35 pm");
    expect(workizDate("2026-09-29")).toBe("Tue Sep 29, 2026");
    expect(workizDate(undefined)).toBe("");
    expect(accountWall("2026-09-29T18:35:00.000Z")).toBe("2026-09-29T14:35");
    expect(accountWall("2026-01-15T04:10:00.000Z")).toBe("2026-01-14T23:10");
  });
});
