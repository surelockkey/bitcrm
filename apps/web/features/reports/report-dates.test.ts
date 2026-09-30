import { describe, expect, it } from "vitest";
import {
  ACTIVITY_PRESETS,
  CALL_TRACKING_PRESETS,
  REPORT_PRESET_LABEL,
  accountToday,
  reportPresetRange,
} from "./report-dates";

// Tuesday 29 Sep 2026 — the day the pickers were checked live.
const TODAY = "2026-09-29";

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

  it.each([
    ["today", "2026-09-29", "2026-09-29"],
    ["yesterday", "2026-09-28", "2026-09-28"],
    ["last_7", "2026-09-22", "2026-09-28"],
    ["last_30", "2026-08-30", "2026-09-28"],
    ["recent", "2026-08-31", "2026-09-29"],
    ["last_month", "2026-08-01", "2026-08-31"],
    ["this_month", "2026-09-01", "2026-09-29"],
    ["this_year", "2026-01-01", "2026-09-29"],
    ["last_year", "2025-01-01", "2025-12-31"],
    ["this_week_sun", "2026-09-27", "2026-09-29"],
    ["this_week_mon", "2026-09-28", "2026-09-29"],
    ["last_week_sun", "2026-09-20", "2026-09-26"],
    ["last_week_mon", "2026-09-21", "2026-09-27"],
    ["last_business_week", "2026-09-21", "2026-09-25"],
    ["last_3_months", "2026-06-01", "2026-08-31"],
    ["last_12_months", "2025-09-01", "2026-08-31"],
    ["all_time", "2015-01-01", "2026-09-29"],
  ] as const)("%s → %s … %s", (preset, from, to) => {
    expect(reportPresetRange(preset, TODAY)).toEqual({ from, to });
  });

  it("leaves Custom to the page", () => {
    expect(reportPresetRange("custom", TODAY)).toBeNull();
  });

  it("counts from today in New York, not in the viewer's zone", () => {
    // 02:00 UTC on the 30th is still the 29th in New York.
    expect(accountToday(new Date("2026-09-30T02:00:00Z"))).toBe("2026-09-29");
  });
});
