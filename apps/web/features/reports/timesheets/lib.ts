import {
  DASHBOARD_TIMEZONE,
  TIMESHEET_JOB_FILTER_LABEL,
  type TimesheetEntriesPage,
  type TimesheetEntryRow,
  type TimesheetJobFilter,
  type TimesheetReportFilters,
  type TimesheetReportPage,
  type TimesheetReportSort,
} from "@bitcrm/types";
import { presetRange as jobsPresetRange, type JobsReportPreset } from "../jobs/lib";

/*
 * The Workiz Timesheets report, web side: the toolbar's state, the requests
 * it makes of `GET /users/timeclock/report` (and `/entries` for an opened
 * row), Workiz's printed cells and both CSVs. The server groups, adds up,
 * sorts and pages; this only holds and prints.
 */

/* ---------------------------------------------------------------- presets */

/**
 * Workiz's date presets on this report, in its order (checked live
 * 2026-09-30): the Jobs report's fifteen plus "Recent (30 days, including
 * today)". All time and the last 3/6/12 months are left out, as in Workiz.
 */
export const TIMESHEET_PRESETS = [
  { id: "custom", label: "Custom" },
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "last_7", label: "Last 7 days" },
  { id: "last_14", label: "Last 14 days" },
  { id: "last_30", label: "Last 30 days" },
  { id: "last_month", label: "Last month" },
  { id: "this_month", label: "This month" },
  { id: "this_year", label: "This year" },
  { id: "last_year", label: "Last year" },
  { id: "this_week_sun", label: "This week (Sun-Today)" },
  { id: "this_week_mon", label: "This week (Mon-Today)" },
  { id: "last_week_sun", label: "Last week (Sun-Sat)" },
  { id: "last_week_mon", label: "Last week (Mon-Sun)" },
  { id: "last_business_week", label: "Last business week (Mon-Fri)" },
  { id: "recent", label: "Recent (30 days, including today)" },
] as const;

export type TimesheetPreset = (typeof TIMESHEET_PRESETS)[number]["id"];

/** Workiz opens its timesheet on this week, Monday to today. */
export const DEFAULT_TIMESHEET_PRESET: TimesheetPreset = "this_week_mon";

const shift = (day: string, days: number): string => {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** Inclusive days of a preset; "Recent" is the thirty days that end today. */
export function timesheetPresetRange(preset: Exclude<TimesheetPreset, "custom">, today: string): { from: string; to: string } {
  if (preset === "recent") return { from: shift(today, -29), to: today };
  return jobsPresetRange(preset as Exclude<JobsReportPreset, "custom">, today);
}

/* ------------------------------------------------------------------ state */

export interface TimesheetReportState {
  from: string;
  to: string;
  filters: TimesheetReportFilters;
  search: string;
  sort: TimesheetReportSort;
  dir: "asc" | "desc";
  page: number;
  pageSize: number;
}

function filterParams(p: URLSearchParams, filters: TimesheetReportFilters): void {
  if (filters.userId?.length) p.set("userId", filters.userId.join(","));
  if (filters.job?.length) p.set("job", filters.job.join(","));
}

export function reportParams(state: TimesheetReportState): string {
  const p = new URLSearchParams({ from: state.from, to: state.to });
  filterParams(p, state.filters);
  const q = state.search.trim();
  if (q) p.set("q", q);
  p.set("sort", state.sort);
  p.set("dir", state.dir);
  p.set("page", String(state.page));
  p.set("pageSize", String(state.pageSize));
  return p.toString();
}

/** The same query, every line in one page — what the export writes. */
export function exportParams(state: TimesheetReportState): string {
  return reportParams({ ...state, page: 1, pageSize: 1000 });
}

export function entriesParams(userId: string, state: Pick<TimesheetReportState, "from" | "to" | "filters">): string {
  const p = new URLSearchParams({ userId, from: state.from, to: state.to });
  if (state.filters.job?.length) p.set("job", state.filters.job.join(","));
  return p.toString();
}

/** Tick or untick one value of a filter group; an emptied group is dropped. */
export function toggleTimesheetFilter(
  filters: TimesheetReportFilters,
  key: keyof TimesheetReportFilters,
  value: string,
): TimesheetReportFilters {
  const current = (filters[key] ?? []) as string[];
  const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
  const out: TimesheetReportFilters = { ...filters };
  if (next.length) (out as Record<string, string[]>)[key] = next;
  else delete out[key];
  return out;
}

export const JOB_FILTER_OPTIONS = (Object.keys(TIMESHEET_JOB_FILTER_LABEL) as TimesheetJobFilter[]).map((value) => ({
  value,
  label: TIMESHEET_JOB_FILTER_LABEL[value],
}));

/* ------------------------------------------------------------------ cells */

/** Workiz's Hours cell (`s0`): hours and minutes, each at least two digits — "145:57", "00:00". */
export function hhmm(minutes: number | undefined): string {
  if (!minutes || minutes < 0) return "00:00";
  const h = Math.floor(minutes / 60);
  const m = Math.floor(minutes - h * 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Workiz's Cost cell: `$` and two decimals, no thousands separator — "$6356.67". */
export const dollars = (n: number | undefined): string => `$${(n ?? 0).toFixed(2)}`;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const wallFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: DASHBOARD_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function wall(iso: string | undefined): { y: number; m: number; d: number; h: number; min: number } | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const p = Object.fromEntries(wallFormat.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), h: Number(p.hour) % 24, min: Number(p.minute) };
}

const h12 = (h: number) => (h % 12 === 0 ? 12 : h % 12);
const ampm = (h: number) => (h < 12 ? "am" : "pm");

/** The Clock in / Clock out cell on the account's clock: "Fri Sep 04 2026 01:23 pm" (Workiz's `ddd MMM DD YYYY hh:mm a`). */
export function clockCell(iso: string | undefined): string {
  const w = wall(iso);
  if (!w) return "";
  const weekday = WEEKDAYS[new Date(Date.UTC(w.y, w.m - 1, w.d)).getUTCDay()];
  return `${weekday} ${MONTHS[w.m - 1]} ${String(w.d).padStart(2, "0")} ${w.y} ${String(h12(w.h)).padStart(2, "0")}:${String(w.min).padStart(2, "0")} ${ampm(w.h)}`;
}

const ordinal = (n: number): string => {
  if (n > 3 && n < 21) return `${n}th`;
  return `${n}${n % 10 === 1 ? "st" : n % 10 === 2 ? "nd" : n % 10 === 3 ? "rd" : "th"}`;
};

/** The same moment as Workiz's export writes it: "September 4th 2026 1:23 pm" (`MMMM Do YYYY h:mm a`). */
export function clockCsv(iso: string | undefined): string {
  const w = wall(iso);
  if (!w) return "";
  return `${MONTHS_LONG[w.m - 1]} ${ordinal(w.d)} ${w.y} ${h12(w.h)}:${String(w.min).padStart(2, "0")} ${ampm(w.h)}`;
}

/** Where the pin opens: the fix on Google Maps. */
export const mapUrl = (loc: { lat: number; lng: number }): string =>
  `https://www.google.com/maps/search/?api=1&query=${loc.lat},${loc.lng}`;

/* ------------------------------------------------------ opened row (client side) */

export type EntrySort = "start" | "hours" | "cost" | "job" | "jobName";

export interface EntryJob {
  number?: string;
  name?: string;
}

/**
 * The opened row's own sort — Workiz: Start (newest first) by default, and
 * Hours, Cost, Job, Job name on a header click. Every entry of the period is
 * already here, so it sorts and pages in the browser.
 */
export function sortEntries(
  rows: TimesheetEntryRow[],
  sort: EntrySort,
  dir: "asc" | "desc",
  jobs: Map<string, EntryJob>,
): TimesheetEntryRow[] {
  const sign = dir === "asc" ? 1 : -1;
  const text = (r: TimesheetEntryRow) =>
    sort === "job" ? (r.dealId ? (jobs.get(r.dealId)?.number ?? "") : "") : r.dealId ? (jobs.get(r.dealId)?.name ?? "") : "";
  return [...rows].sort((a, b) => {
    let d = 0;
    if (sort === "start") d = a.startedAt < b.startedAt ? -1 : a.startedAt > b.startedAt ? 1 : 0;
    else if (sort === "hours") d = a.minutes - b.minutes;
    else if (sort === "cost") d = (a.cost ?? 0) - (b.cost ?? 0);
    else d = text(a).localeCompare(text(b));
    return d !== 0 ? sign * d : a.startedAt < b.startedAt ? 1 : -1;
  });
}

/* -------------------------------------------------------------------- CSV */

const cell = (v: string | number): string => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csv = (rows: (string | number)[][]): string => rows.map((r) => r.map(cell).join(",")).join("\n");

/**
 * The report as Workiz exports it: User, Hours, Cost, Gross Hours, Gross Cost,
 * Jobs (the two Gross columns are CSV-only in Workiz), the "Total:" line first
 * as on screen. The money columns only when the caller may see money.
 */
export function timesheetsCsv(page: Pick<TimesheetReportPage, "rows" | "total" | "money">): string {
  const money = page.money;
  const head = ["User", "Hours", ...(money ? ["Cost"] : []), "Gross Hours", ...(money ? ["Gross Cost"] : []), "Jobs"];
  const line = (name: string, r: { minutes: number; grossMinutes: number; cost?: number; grossCost?: number; jobs: number }) => [
    name,
    hhmm(r.minutes),
    ...(money ? [dollars(r.cost)] : []),
    hhmm(r.grossMinutes),
    ...(money ? [dollars(r.grossCost)] : []),
    r.jobs,
  ];
  return csv([head, line("Total:", page.total), ...page.rows.map((r) => line(r.name, r))]);
}

/**
 * One person's entries as Workiz exports an opened row: User, Clock in,
 * Clock out, Hours, Cost, Job, Job name, Notes, then its "Total" and
 * "Gross Total" lines.
 */
export function entriesCsv(
  page: Pick<TimesheetEntriesPage, "name" | "rows" | "total" | "money">,
  rows: TimesheetEntryRow[],
  jobs: Map<string, EntryJob>,
): string {
  const money = page.money;
  const head = ["User", "Clock in", "Clock out", "Hours", ...(money ? ["Cost"] : []), "Job", "Job name", "Notes"];
  const body = rows.map((r) => [
    page.name,
    clockCsv(r.startedAt),
    clockCsv(r.endedAt),
    hhmm(r.minutes),
    ...(money ? [dollars(r.cost)] : []),
    r.dealId ? (jobs.get(r.dealId)?.number ?? "") : "",
    r.dealId ? (jobs.get(r.dealId)?.name ?? "") : "",
    r.notes ?? "",
  ]);
  const extra = (label: string, minutes: number, cost?: number) => [
    label,
    "",
    "",
    hhmm(minutes),
    ...(money ? [dollars(cost)] : []),
    "",
    "",
    "",
  ];
  return csv([
    head,
    ...body,
    extra("Total", page.total.minutes, page.total.cost),
    extra("Gross Total", page.total.grossMinutes, page.total.grossCost),
  ]);
}

/** Hand a CSV to the browser as a download. */
export function saveCsv(content: string, fileName: string): void {
  if (typeof URL.createObjectURL !== "function") return;
  const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName.replace(/[^\w.-]+/g, "-");
  a.click();
  URL.revokeObjectURL(url);
}
