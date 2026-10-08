import { describe, expect, it } from "vitest";
import {
  JOBS_REPORT_PRESETS,
  accountToday,
  accountWall,
  viewerToday,
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

  // Workiz's datepicker (report_table_and_datepicker.js getOptions) and the
  // live Jobs report on 2026-10-09: "Last 7 days" = Oct 3rd - Oct 9th, today
  // included; Last 14 = Sep 26th -, Last 30 = Sep 10th - (rep_jobs notes).
  it("counts like Workiz — 'Last N days' run up to today, today included", () => {
    expect(presetRange("today", today)).toEqual({ from: today, to: today });
    expect(presetRange("yesterday", today)).toEqual({ from: "2026-09-28", to: "2026-09-28" });
    expect(presetRange("last_7", today)).toEqual({ from: "2026-09-23", to: today });
    expect(presetRange("last_14", today)).toEqual({ from: "2026-09-16", to: today });
    expect(presetRange("last_30", today)).toEqual({ from: "2026-08-31", to: today });
    expect(presetRange("last_7", "2026-10-09")).toEqual({ from: "2026-10-03", to: "2026-10-09" });
    expect(presetRange("last_14", "2026-10-09")).toEqual({ from: "2026-09-26", to: "2026-10-09" });
    expect(presetRange("last_30", "2026-10-09")).toEqual({ from: "2026-09-10", to: "2026-10-09" });
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
    // Friday 2026-10-09, read live: Sun-Today Oct 4th -, Last week (Sun-Sat) Sep 27th - Oct 3rd.
    expect(presetRange("this_week_sun", "2026-10-09")).toEqual({ from: "2026-10-04", to: "2026-10-09" });
    expect(presetRange("last_week_sun", "2026-10-09")).toEqual({ from: "2026-09-27", to: "2026-10-03" });
    expect(presetRange("last_week_mon", "2026-10-09")).toEqual({ from: "2026-09-28", to: "2026-10-04" });
    expect(presetRange("last_business_week", "2026-10-09")).toEqual({ from: "2026-09-28", to: "2026-10-02" });
    // A Sunday belongs to the Monday week that is ending.
    expect(presetRange("this_week_mon", "2026-10-04")).toEqual({ from: "2026-09-28", to: "2026-10-04" });
  });

  // Workiz counts its weeks with moment's isoWeekday: isoWeekday(0) is the
  // Sunday before this ISO week's Monday — on a Sunday, the Sunday a week
  // back — and isoWeekday(6) is the Saturday of this ISO week, yesterday.
  it("on a Sunday, counts the Sunday weeks as moment's isoWeekday does", () => {
    expect(presetRange("this_week_sun", "2026-10-04")).toEqual({ from: "2026-09-27", to: "2026-10-04" });
    expect(presetRange("last_week_sun", "2026-10-04")).toEqual({ from: "2026-09-20", to: "2026-09-26" });
    expect(presetRange("last_week_mon", "2026-10-04")).toEqual({ from: "2026-09-21", to: "2026-09-27" });
    expect(presetRange("last_business_week", "2026-10-04")).toEqual({ from: "2026-09-21", to: "2026-09-25" });
  });

  it("takes today off the Eastern calendar", () => {
    // 02:30 UTC on the 30th is still the 29th in New York.
    expect(accountToday(new Date("2026-09-30T02:30:00Z"))).toBe("2026-09-29");
  });

  // Workiz's presets count from moment(): the viewer's own clock. At 00:01 in
  // Kyiv on Oct 9 (17:01 in New York, Oct 8) its "Today" read Oct 9th.
  it("counts the presets from the viewer's own today, as Workiz does", () => {
    const at = new Date(2026, 9, 9, 0, 1); // local wall clock
    expect(viewerToday(at)).toBe("2026-10-09");
    expect(viewerToday(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
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
