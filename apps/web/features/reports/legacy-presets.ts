/*
 * The period list of Workiz's LEGACY report pages — the PHP pages it iframes
 * (Job Statistics `/statistics_report/`, Commissions `/finance_report/`), whose
 * `.date_picker_gen` the server renders. Their "Last N days" END YESTERDAY
 * (live 2026-10-09: Last 7 days = Oct 02 – Oct 08 on both pages), where the
 * React reports (Jobs, Activity, Payments, Items, Tax, Aging — `jobs/lib.ts`
 * `presetRange`, `report-dates.ts`) count up to today. Pair it with
 * `WzPeriodPicker`.
 */

/** Workiz's thirteen legacy presets, in its order and its spelling ("This week(Sun - Today)", no space). */
export const LEGACY_REPORT_PRESETS = [
  { id: "custom", label: "Custom" },
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "this_week_sun", label: "This week(Sun - Today)" },
  { id: "this_week_mon", label: "This week (Mon - Today)" },
  { id: "last_7_days", label: "Last 7 days" },
  { id: "last_week_sun", label: "Last week (Sun - Sat)" },
  { id: "last_week_mon", label: "Last week (Mon - Sun)" },
  { id: "last_business_week", label: "Last business week (Mon - Fri)" },
  { id: "last_14_days", label: "Last 14 days" },
  { id: "this_month", label: "This month" },
  { id: "last_30_days", label: "Last 30 days" },
  { id: "last_month", label: "Last month" },
] as const;

export type LegacyReportPreset = (typeof LEGACY_REPORT_PRESETS)[number]["id"];

const shift = (day: string, days: number): string => {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
/** The same day a month back, overflowing as PHP's "-1 month" does (Mar 31 → Feb 31 → Mar 3). */
const monthBack = (day: string): string => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 2, d)).toISOString().slice(0, 10);
};
/** 0 = Sunday … 6 = Saturday. */
const weekday = (day: string): number => new Date(`${day}T00:00:00.000Z`).getUTCDay();

/**
 * The days a legacy preset covers, both ends included, counted from `today`
 * (the account's day). Seen live on Fridays only: a Sunday is taken as the
 * first day of its Sun–Sat week and the last of its Mon–Sun week. `null` for
 * Custom — the page holds its own days.
 */
export function legacyPresetRange(preset: LegacyReportPreset, today: string): { from: string; to: string } | null {
  const sunday = shift(today, -weekday(today));
  const monday = shift(today, weekday(today) === 0 ? -6 : 1 - weekday(today));
  const yesterday = shift(today, -1);
  switch (preset) {
    case "custom":
      return null;
    case "today":
      return { from: today, to: today };
    case "yesterday":
      return { from: yesterday, to: yesterday };
    case "this_week_sun":
      return { from: sunday, to: today };
    case "this_week_mon":
      return { from: monday, to: today };
    case "last_7_days":
      return { from: shift(today, -7), to: yesterday };
    case "last_week_sun":
      return { from: shift(sunday, -7), to: shift(sunday, -1) };
    case "last_week_mon":
      return { from: shift(monday, -7), to: shift(monday, -1) };
    case "last_business_week":
      return { from: shift(monday, -7), to: shift(monday, -3) };
    case "last_14_days":
      return { from: shift(today, -14), to: yesterday };
    case "this_month":
      return { from: `${today.slice(0, 7)}-01`, to: today };
    case "last_30_days":
      return { from: monthBack(today), to: yesterday };
    case "last_month": {
      const lastOfPrev = shift(`${today.slice(0, 7)}-01`, -1);
      return { from: `${lastOfPrev.slice(0, 7)}-01`, to: lastOfPrev };
    }
  }
}
