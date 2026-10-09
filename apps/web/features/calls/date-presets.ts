import { accountWindowUtc } from "@bitcrm/types";
import { DEFAULT_TZ } from "@/lib/timezone";
import { reportPresetRange, type ReportPreset } from "@/features/reports/report-dates";

/**
 * The call log's date box — Workiz's report picker list without "Recent"
 * and the "Last N months" (callspage_wz_06_date_open). Today is the default,
 * as Workiz opens the page on it.
 */
export const CALLS_PRESETS: ReportPreset[] = [
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
];

export const DEFAULT_CALLS_PRESET: ReportPreset = "today";

/**
 * The days a preset covers, both ends included — the reports' own rules:
 * Workiz's call log counts "Last 7 days" up to TODAY (Oct 2–8 on the 8th),
 * as its reports do (rep_activity, 2026-10-09). `null` for Custom — the
 * page holds those days.
 */
export function callsPresetRange(preset: ReportPreset, today: string): { from: string; to: string } | null {
  return reportPresetRange(preset, today);
}

/**
 * Account days → the instants `GET /telephony/calls` filters `startedAt` by:
 * the first millisecond of `from` to the last of `to`, on the account's clock.
 */
export function dayRangeToInstants(
  range: { from: string; to: string },
  timeZone: string = DEFAULT_TZ,
): { dateFrom: string; dateTo: string } {
  const { start, end } = accountWindowUtc(range.from, range.to, timeZone);
  return { dateFrom: start, dateTo: new Date(Date.parse(end) - 1).toISOString() };
}
