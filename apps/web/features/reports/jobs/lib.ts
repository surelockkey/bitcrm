import {
  DASHBOARD_TIMEZONE,
  dashboardDay,
  JOBS_REPORT_COLUMNS,
  type JobsReportBy,
  type JobsReportColumnId,
  type JobsReportFilters,
} from "@bitcrm/types";

/*
 * The Workiz Jobs report, web side: what the toolbar holds, the request it
 * makes of `GET /deals/report`, the date presets and the printed cells. The
 * rows, their names, the sort and the paging all come from the server.
 */

/* ---------------------------------------------------------------- presets */

/** Workiz's date presets, in its order (checked live 2026-09-29). */
export const JOBS_REPORT_PRESETS = [
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
] as const;

export type JobsReportPreset = (typeof JOBS_REPORT_PRESETS)[number]["id"];

/** Workiz opens its report on this week, Monday to today. */
export const DEFAULT_PRESET: JobsReportPreset = "this_week_mon";

/** Today on the account's calendar (America/New_York) — the day the presets count from. */
export function accountToday(now: Date = new Date()): string {
  return dashboardDay(now, DASHBOARD_TIMEZONE);
}

const shift = (day: string, days: number): string => {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const weekday = (day: string): number => new Date(`${day}T00:00:00.000Z`).getUTCDay(); // 0 = Sunday

/**
 * Inclusive days of a preset. "Last N days" ends yesterday — Workiz's
 * "Last 7 days" on 2026-09-29 is 22–28.09 (checked live).
 */
export function presetRange(preset: Exclude<JobsReportPreset, "custom">, today: string): { from: string; to: string } {
  const year = today.slice(0, 4);
  const firstOfMonth = `${today.slice(0, 7)}-01`;
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
    case "last_month": {
      const end = shift(firstOfMonth, -1);
      return { from: `${end.slice(0, 7)}-01`, to: end };
    }
    case "this_month":
      return { from: firstOfMonth, to: today };
    case "this_year":
      return { from: `${year}-01-01`, to: today };
    case "last_year":
      return { from: `${Number(year) - 1}-01-01`, to: `${Number(year) - 1}-12-31` };
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
  }
}

/* ------------------------------------------------------------------ state */

export const JOBS_REPORT_PAGE_SIZES = [5, 10, 20, 25, 50, 100, 500, 1000] as const;

export interface JobsReportState {
  by: JobsReportBy;
  from: string;
  to: string;
  filters: JobsReportFilters;
  search: string;
  sort: JobsReportColumnId;
  dir: "asc" | "desc";
  page: number;
  pageSize: number;
}

const FILTER_KEYS = [
  "status",
  "techId",
  "createdBy",
  "tagId",
  "jobTypeId",
  "origin",
  "sourceId",
  "serviceAreaId",
  "externalCompanyId",
] as const satisfies readonly (keyof JobsReportFilters)[];

/** The query both the page and the export send — the export adds its columns and no paging. */
function baseParams(state: JobsReportState): URLSearchParams {
  const p = new URLSearchParams({ by: state.by, from: state.from, to: state.to });
  for (const key of FILTER_KEYS) {
    const values = state.filters[key];
    if (values?.length) p.set(key, values.join(","));
  }
  const q = state.search.trim();
  if (q) p.set("q", q);
  p.set("sort", state.sort);
  p.set("dir", state.dir);
  return p;
}

export function reportParams(state: JobsReportState): string {
  const p = baseParams(state);
  p.set("page", String(state.page));
  p.set("pageSize", String(state.pageSize));
  return p.toString();
}

export function exportParams(state: JobsReportState, columns: readonly JobsReportColumnId[]): string {
  const p = baseParams(state);
  p.set("columns", columns.join(","));
  return p.toString();
}

/**
 * Tick or untick one value of a filter group; an emptied group is dropped.
 * Any report's filter groups (the Sales report's too), the Jobs report's by default.
 */
export function toggleFilter(filters: JobsReportFilters, key: keyof JobsReportFilters, value: string): JobsReportFilters;
export function toggleFilter<F extends object>(filters: F, key: keyof F, value: string): F;
export function toggleFilter(filters: object, key: PropertyKey, value: string): object {
  const current = ((filters as Record<string, unknown>)[key as string] ?? []) as string[];
  const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
  const out = { ...filters } as Record<string, string[] | undefined>;
  if (next.length) out[key as string] = next;
  else delete out[key as string];
  return out;
}

/** Add a value to a group (a click on a cell): never removes, never duplicates. */
export function addFilter(filters: JobsReportFilters, key: keyof JobsReportFilters, value: string): JobsReportFilters {
  const current = (filters[key] ?? []) as string[];
  return current.includes(value) ? filters : ({ ...filters, [key]: [...current, value] } as JobsReportFilters);
}

export const filterCount = (filters: JobsReportFilters): number =>
  FILTER_KEYS.reduce((n, k) => n + (filters[k]?.length ?? 0), 0);

/* ---------------------------------------------------------------- columns */

export const COLUMN_LABEL = new Map<JobsReportColumnId, string>(JOBS_REPORT_COLUMNS.map((c) => [c.id, c.label]));

/** The chosen columns in the report's fixed order (Workiz does not reorder). */
export function inReportOrder(columns: readonly JobsReportColumnId[]): JobsReportColumnId[] {
  return JOBS_REPORT_COLUMNS.map((c) => c.id).filter((id) => columns.includes(id));
}

/* ------------------------------------------------------------------ cells */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Workiz's date cell from an account wall clock (`YYYY-MM-DDTHH:MM`):
 * `Tue Sep 29, 2026 02:35 pm`; a bare day prints without the time.
 */
export function workizDate(wall: string | undefined): string {
  if (!wall || !/^\d{4}-\d{2}-\d{2}/.test(wall)) return "";
  const [y, m, d] = wall.slice(0, 10).split("-").map(Number);
  const day = `${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${MONTHS[m - 1]} ${String(d).padStart(2, "0")}, ${y}`;
  const time = wall.slice(11, 16);
  if (!/^\d{2}:\d{2}$/.test(time)) return day;
  const [h, min] = time.split(":").map(Number);
  return `${day} ${String(h % 12 === 0 ? 12 : h % 12).padStart(2, "0")}:${String(min).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}

const wallFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: DASHBOARD_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** An ISO instant on the account's wall clock (`YYYY-MM-DDTHH:MM`). */
export function accountWall(iso: string | undefined): string | undefined {
  if (!iso) return undefined;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return undefined;
  const p = Object.fromEntries(wallFormat.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour === "24" ? "00" : p.hour}:${p.minute}`;
}

export const money = (n: number | undefined): string =>
  typeof n === "number" ? n.toLocaleString("en-US", { style: "currency", currency: "USD" }) : "";
