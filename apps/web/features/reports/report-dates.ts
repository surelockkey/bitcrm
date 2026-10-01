import { ACTIVITY_FIRST_DAY, DASHBOARD_TIMEZONE, dashboardDay } from "@bitcrm/types";

/*
 * Workiz's report date picker, for the reports that use its long list
 * (Activity, Call Tracking): the presets in Workiz's order, and the account
 * days each one covers. Days are the business's (America/New_York) — the
 * calendar the servers count by.
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

const shift = (day: string, n: number): string => {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const weekday = (day: string): number => new Date(`${day}T00:00:00.000Z`).getUTCDay(); // 0 = Sunday
const monthsBack = (day: string, n: number): string => {
  const [y, m] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 - n, 1)).toISOString().slice(0, 10);
};

/**
 * The account days a preset covers, both ends included. "Last N days" ends
 * yesterday (Workiz's "Last 7 days" on 29.09 is 22–28.09); "Recent" is the 30
 * days up to and including today; "Last N months" are whole months. `null`
 * for Custom — the page holds its own days.
 */
export function reportPresetRange(preset: ReportPreset, today: string): { from: string; to: string } | null {
  const firstOfMonth = `${today.slice(0, 7)}-01`;
  const year = Number(today.slice(0, 4));
  const sunday = shift(today, -weekday(today));
  const monday = shift(today, weekday(today) === 0 ? -6 : 1 - weekday(today));
  switch (preset) {
    case "today":
      return { from: today, to: today };
    case "yesterday":
      return { from: shift(today, -1), to: shift(today, -1) };
    case "last_7":
      return { from: shift(today, -7), to: shift(today, -1) };
    case "last_14":
      return { from: shift(today, -14), to: shift(today, -1) };
    case "last_30":
      return { from: shift(today, -30), to: shift(today, -1) };
    case "recent":
      return { from: shift(today, -29), to: today };
    case "last_month":
      return { from: monthsBack(today, 1), to: shift(firstOfMonth, -1) };
    case "this_month":
      return { from: firstOfMonth, to: today };
    case "this_year":
      return { from: `${year}-01-01`, to: today };
    case "last_year":
      return { from: `${year - 1}-01-01`, to: `${year - 1}-12-31` };
    case "this_week_sun":
      return { from: sunday, to: today };
    case "this_week_mon":
      return { from: monday, to: today };
    case "last_week_sun":
      return { from: shift(sunday, -7), to: shift(sunday, -1) };
    case "last_week_mon":
      return { from: shift(monday, -7), to: shift(monday, -1) };
    case "last_business_week":
      return { from: shift(monday, -7), to: shift(monday, -3) };
    case "last_3_months":
      return { from: monthsBack(today, 3), to: shift(firstOfMonth, -1) };
    case "last_6_months":
      return { from: monthsBack(today, 6), to: shift(firstOfMonth, -1) };
    case "last_12_months":
      return { from: monthsBack(today, 12), to: shift(firstOfMonth, -1) };
    case "all_time":
      return { from: ACTIVITY_FIRST_DAY, to: today };
    case "custom":
      return null;
  }
}
