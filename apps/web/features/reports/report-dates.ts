import { ACTIVITY_FIRST_DAY, DASHBOARD_TIMEZONE, dashboardDay } from "@bitcrm/types";
import { presetRange, viewerToday } from "./jobs/lib";

/*
 * Workiz's report date picker, for the reports that use its long list
 * (Activity, Call Tracking) and the call log: the presets in Workiz's order,
 * and the days each one covers, counted from the viewer's today as Workiz
 * does. The servers read those days on the business's calendar
 * (America/New_York).
 */

export type ReportPreset =
  | "custom"
  | "today"
  | "yesterday"
  | "last_7"
  | "last_14"
  | "last_30"
  | "last_month"
  | "this_month"
  | "this_year"
  | "last_year"
  | "this_week_sun"
  | "this_week_mon"
  | "last_week_sun"
  | "last_week_mon"
  | "last_business_week"
  | "last_3_months"
  | "last_6_months"
  | "last_12_months"
  | "all_time"
  | "recent";

export const REPORT_PRESET_LABEL: Record<ReportPreset, string> = {
  custom: "Custom",
  today: "Today",
  yesterday: "Yesterday",
  last_7: "Last 7 days",
  last_14: "Last 14 days",
  last_30: "Last 30 days",
  last_month: "Last month",
  this_month: "This month",
  this_year: "This year",
  last_year: "Last year",
  this_week_sun: "This week (Sun-Today)",
  this_week_mon: "This week (Mon-Today)",
  last_week_sun: "Last week (Sun-Sat)",
  last_week_mon: "Last week (Mon-Sun)",
  last_business_week: "Last business week (Mon-Fri)",
  last_3_months: "Last 3 months",
  last_6_months: "Last six months",
  last_12_months: "Last twelve months",
  all_time: "All time",
  recent: "Recent (30 days, including today)",
};

/** Activity's picker, as Workiz shows it (checked live 2026-09-29). */
export const ACTIVITY_PRESETS: ReportPreset[] = [
  "custom",
  "today",
  "yesterday",
  "last_7",
  "last_14",
  "last_30",
  "last_month",
  "this_month",
  "this_year",
  "last_year",
  "this_week_sun",
  "this_week_mon",
  "last_week_sun",
  "last_week_mon",
  "last_business_week",
  "last_3_months",
  "last_6_months",
  "last_12_months",
  "all_time",
  "recent",
];

/** Call Tracking's picker: the same, without "Last N months" and "All time". */
export const CALL_TRACKING_PRESETS: ReportPreset[] = ACTIVITY_PRESETS.filter(
  (p) => !["last_3_months", "last_6_months", "last_12_months", "all_time"].includes(p),
);

/** Today on the account's calendar. */
export function accountToday(now: Date = new Date()): string {
  return dashboardDay(now, DASHBOARD_TIMEZONE);
}

/**
 * The day the presets count from: the viewer's own today, as Workiz's
 * datepicker counts from `moment()` (rep_activity, 2026-10-09: at 01:25 in
 * Kyiv — 18:25 the day before in New York — its "Today" asked for Oct 9).
 * The server still reads the days it is given on the account's calendar.
 */
export function reportToday(now: Date = new Date()): string {
  return viewerToday(now);
}

const shift = (day: string, n: number): string => {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const monthsBack = (day: string, n: number): string => {
  const [y, m] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 - n, 1)).toISOString().slice(0, 10);
};

/**
 * The days a preset covers, both ends included — Workiz's datepicker rules
 * (report_table_and_datepicker.js getOptions, read live 2026-10-09). The
 * presets the Jobs report shares come from its `presetRange`: "Last N days"
 * up to and including today, weeks by moment's isoWeekday. "Last N months"
 * are whole months before this one; "Recent" is today and the thirty days
 * before it (Sep 9th - Oct 9th on the 9th); "All time" reaches back to the
 * account's first activity. `null` for Custom — the page holds its own days.
 */
export function reportPresetRange(preset: ReportPreset, today: string): { from: string; to: string } | null {
  const lastOfLastMonth = shift(`${today.slice(0, 7)}-01`, -1);
  switch (preset) {
    case "custom":
      return null;
    case "last_3_months":
      return { from: monthsBack(today, 3), to: lastOfLastMonth };
    case "last_6_months":
      return { from: monthsBack(today, 6), to: lastOfLastMonth };
    case "last_12_months":
      return { from: monthsBack(today, 12), to: lastOfLastMonth };
    case "recent":
      return { from: shift(today, -30), to: today };
    case "all_time":
      return { from: ACTIVITY_FIRST_DAY, to: today };
    default:
      return presetRange(preset, today);
  }
}
