import { describe, expect, it } from "vitest";
import {
  ACTIVITY_PRESETS,
  CALL_TRACKING_PRESETS,
  REPORT_PRESET_LABEL,
  accountToday,
  reportPresetRange,
  reportToday,
} from "./report-dates";

// Friday 9 Oct 2026 — the day Workiz's Activity picker was read live
// (rep_activity, preset_ranges_2026-10-09.json: the date_query each preset sent).
const TODAY = "2026-10-09";

describe("Workiz's report date presets", () => {
  it("lists Activity's twenty options and Call Tracking's sixteen, in Workiz's order", () => {
    expect(ACTIVITY_PRESETS.map((p) => REPORT_PRESET_LABEL[p])).toEqual([
      "Custom", "Today", "Yesterday", "Last 7 days", "Last 14 days", "Last 30 days", "Last month",
      "This month", "This year", "Last year", "This week (Sun-Today)", "This week (Mon-Today)",
      "Last week (Sun-Sat)", "Last week (Mon-Sun)", "Last business week (Mon-Fri)", "Last 3 months",
      "Last six months", "Last twelve months", "All time", "Recent (30 days, including today)",
    ]);
    expect(CALL_TRACKING_PRESETS).toHaveLength(16);
    expect(CALL_TRACKING_PRESETS).not.toContain("all_time");
    expect(CALL_TRACKING_PRESETS).not.toContain("last_3_months");
  });

  // What Workiz sent for each preset on Fri 2026-10-09: "Last N days" run up
  // to today, today included; "Recent" is today and the thirty days before it.
  it.each([
    ["today", "2026-10-09", "2026-10-09"],
    ["yesterday", "2026-10-08", "2026-10-08"],
    ["last_7", "2026-10-03", "2026-10-09"],
    ["last_14", "2026-09-26", "2026-10-09"],
    ["last_30", "2026-09-10", "2026-10-09"],
    ["last_month", "2026-09-01", "2026-09-30"],
    ["this_month", "2026-10-01", "2026-10-09"],
    ["this_year", "2026-01-01", "2026-10-09"],
    ["last_year", "2025-01-01", "2025-12-31"],
    ["this_week_sun", "2026-10-04", "2026-10-09"],
    ["this_week_mon", "2026-10-05", "2026-10-09"],
    ["last_week_sun", "2026-09-27", "2026-10-03"],
    ["last_week_mon", "2026-09-28", "2026-10-04"],
    ["last_business_week", "2026-09-28", "2026-10-02"],
    ["last_3_months", "2026-07-01", "2026-09-30"],
    ["last_6_months", "2026-04-01", "2026-09-30"],
    ["last_12_months", "2025-10-01", "2026-09-30"],
    ["recent", "2026-09-09", "2026-10-09"],
    ["all_time", "2015-01-01", "2026-10-09"],
  ] as const)("%s → %s … %s", (preset, from, to) => {
    expect(reportPresetRange(preset, TODAY)).toEqual({ from, to });
  });

  // moment's isoWeekday: isoWeekday(0) is the Sunday before this ISO week's
  // Monday — on a Sunday, the Sunday a week back.
  it("on a Sunday, counts the weeks as moment's isoWeekday does", () => {
    const sunday = "2026-10-04";
    expect(reportPresetRange("this_week_sun", sunday)).toEqual({ from: "2026-09-27", to: sunday });
    expect(reportPresetRange("this_week_mon", sunday)).toEqual({ from: "2026-09-28", to: sunday });
    expect(reportPresetRange("last_week_sun", sunday)).toEqual({ from: "2026-09-20", to: "2026-09-26" });
    expect(reportPresetRange("last_week_mon", sunday)).toEqual({ from: "2026-09-21", to: "2026-09-27" });
    expect(reportPresetRange("last_business_week", sunday)).toEqual({ from: "2026-09-21", to: "2026-09-25" });
  });

  it("leaves Custom to the page", () => {
    expect(reportPresetRange("custom", TODAY)).toBeNull();
  });

  // At 01:25 in Kyiv on Oct 9 (18:25 on Oct 8 in New York) Workiz's "Today"
  // asked for 9.10.26 — the presets count from the viewer's own clock.
  it("counts the presets from the viewer's own today", () => {
    expect(reportToday(new Date(2026, 9, 9, 1, 25))).toBe("2026-10-09");
  });

  it("still knows the account's (New York) today", () => {
    // 02:00 UTC on the 30th is still the 29th in New York.
    expect(accountToday(new Date("2026-09-30T02:00:00Z"))).toBe("2026-09-29");
  });
});
