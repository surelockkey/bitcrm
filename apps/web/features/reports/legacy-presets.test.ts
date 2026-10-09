import { describe, expect, it } from "vitest";
import { LEGACY_REPORT_PRESETS, legacyPresetRange } from "./legacy-presets";

/*
 * Workiz's legacy PHP report pages (Job Statistics `/statistics_report/`,
 * Commissions `/finance_report/`) render their period list on the server.
 * Both pages offered exactly these days, read off `.date_picker_gen_menu_title`
 * (`q="DD.MM.YY_DD.MM.YY"`): live on Friday 2026-10-09
 * (rep_commission_wz_20_statistics_presets_open, scratchpad
 * legacy_presets_2026-10-09.json) and in the pages saved on Friday 2026-09-25
 * (workiz_reports/job-statistics/statistics_report.source.html,
 * commissions-legacy/finance_report.source.html).
 */

const LIVE: Record<string, Array<[string, string, string]>> = {
  "2026-10-09": [
    ["today", "2026-10-09", "2026-10-09"],
    ["yesterday", "2026-10-08", "2026-10-08"],
    ["this_week_sun", "2026-10-04", "2026-10-09"],
    ["this_week_mon", "2026-10-05", "2026-10-09"],
    ["last_7_days", "2026-10-02", "2026-10-08"],
    ["last_week_sun", "2026-09-27", "2026-10-03"],
    ["last_week_mon", "2026-09-28", "2026-10-04"],
    ["last_business_week", "2026-09-28", "2026-10-02"],
    ["last_14_days", "2026-09-25", "2026-10-08"],
    ["this_month", "2026-10-01", "2026-10-09"],
    ["last_30_days", "2026-09-09", "2026-10-08"],
    ["last_month", "2026-09-01", "2026-09-30"],
  ],
  "2026-09-25": [
    ["today", "2026-09-25", "2026-09-25"],
    ["yesterday", "2026-09-24", "2026-09-24"],
    ["this_week_sun", "2026-09-20", "2026-09-25"],
    ["this_week_mon", "2026-09-21", "2026-09-25"],
    ["last_7_days", "2026-09-18", "2026-09-24"],
    ["last_week_sun", "2026-09-13", "2026-09-19"],
    ["last_week_mon", "2026-09-14", "2026-09-20"],
    ["last_business_week", "2026-09-14", "2026-09-18"],
    ["last_14_days", "2026-09-11", "2026-09-24"],
    ["this_month", "2026-09-01", "2026-09-25"],
    ["last_30_days", "2026-08-25", "2026-09-24"],
    ["last_month", "2026-08-01", "2026-08-31"],
  ],
};

describe("LEGACY_REPORT_PRESETS", () => {
  it("lists Workiz's thirteen in its order and its spelling", () => {
    expect(LEGACY_REPORT_PRESETS.map((p) => p.label)).toEqual([
      "Custom",
      "Today",
      "Yesterday",
      "This week(Sun - Today)",
      "This week (Mon - Today)",
      "Last 7 days",
      "Last week (Sun - Sat)",
      "Last week (Mon - Sun)",
      "Last business week (Mon - Fri)",
      "Last 14 days",
      "This month",
      "Last 30 days",
      "Last month",
    ]);
  });
});

describe("legacyPresetRange — the days Workiz's legacy pages offered", () => {
  for (const [today, cases] of Object.entries(LIVE)) {
    it.each(cases)(`${today}: %s → %s … %s`, (preset, from, to) => {
      expect(legacyPresetRange(preset as never, today)).toEqual({ from, to });
    });
  }

  it("“Last N days” end yesterday — unlike the React reports, which count today", () => {
    expect(legacyPresetRange("last_7_days", "2026-10-09")?.to).toBe("2026-10-08");
  });

  it("“Last 30 days” starts on the same day last month, overflowing as PHP's “-1 month” does", () => {
    // Mar 31 → "Feb 31" → Mar 3.
    expect(legacyPresetRange("last_30_days", "2026-03-31")).toEqual({ from: "2026-03-03", to: "2026-03-30" });
    expect(legacyPresetRange("last_30_days", "2026-01-15")).toEqual({ from: "2025-12-15", to: "2026-01-14" });
  });

  it("Custom is the page's own days", () => {
    expect(legacyPresetRange("custom", "2026-10-09")).toBeNull();
  });

  // Not yet seen live (only Fridays were captured): a Sunday is read as the
  // first day of its Sun–Sat week and the last of its Mon–Sun week.
  it("a Sunday (assumed): its own Sun–Sat week starts today; the Mon–Sun week ends today", () => {
    expect(legacyPresetRange("this_week_sun", "2026-10-11")).toEqual({ from: "2026-10-11", to: "2026-10-11" });
    expect(legacyPresetRange("this_week_mon", "2026-10-11")).toEqual({ from: "2026-10-05", to: "2026-10-11" });
    expect(legacyPresetRange("last_week_sun", "2026-10-11")).toEqual({ from: "2026-10-04", to: "2026-10-10" });
    expect(legacyPresetRange("last_week_mon", "2026-10-11")).toEqual({ from: "2026-09-28", to: "2026-10-04" });
  });
});
