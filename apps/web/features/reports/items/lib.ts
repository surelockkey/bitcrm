import { type ItemsReportFilters, type ItemsReportSort } from "@bitcrm/types";
import { JOBS_REPORT_PRESETS, presetRange, type JobsReportPreset } from "../jobs/lib";

/*
 * The Workiz Items and services report, web side: what the toolbar holds,
 * the requests it makes of `GET /deals/report/items` (and `/items/jobs`,
 * `/items/export`), the date presets and the printed cells. Rows, totals,
 * sort and paging come from the server.
 */

/* ---------------------------------------------------------------- presets */

/**
 * Workiz's presets on this report (checked live 2026-09-29): the Jobs
 * report's fifteen plus "Last 3 months"; no All time.
 */
export const ITEMS_REPORT_PRESETS = [
  ...JOBS_REPORT_PRESETS,
  { id: "last_3_months", label: "Last 3 months" },
] as const;

export type ItemsReportPreset = JobsReportPreset | "last_3_months";

/** Workiz opens this report on This month. */
export const DEFAULT_ITEMS_PRESET: ItemsReportPreset = "this_month";

const shift = (day: string, days: number): string => {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/**
 * Inclusive days of a preset. "Last 3 months" is the three whole months
 * before this one (on 2026-09-30: June 1 – August 31), as the Payments
 * report reads Workiz's "Last N months".
 */
export function itemsPresetRange(preset: Exclude<ItemsReportPreset, "custom">, today: string): { from: string; to: string } {
  if (preset !== "last_3_months") return presetRange(preset, today);
  const firstOfMonth = `${today.slice(0, 7)}-01`;
  const [y, m] = today.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1 - 3, 1)).toISOString().slice(0, 10);
  return { from: start, to: shift(firstOfMonth, -1) };
}

/* ------------------------------------------------------------------ state */

/** Workiz's page sizes on this report; 50 is the default. */
export const ITEMS_REPORT_PAGE_SIZES = [5, 10, 20, 25, 50, 100] as const;

export interface ItemsReportState {
  from: string;
  to: string;
  filters: ItemsReportFilters;
  search: string;
  sort: ItemsReportSort;
  dir: "asc" | "desc";
  page: number;
  pageSize: number;
}

export const FILTER_KEYS = ["type", "jobTypeId", "category", "soldBy"] as const satisfies readonly (keyof ItemsReportFilters)[];

/** The query every call shares — the window, the filters, the search. */
function baseParams(state: Pick<ItemsReportState, "from" | "to" | "filters" | "search">): URLSearchParams {
  const p = new URLSearchParams({ from: state.from, to: state.to });
  for (const key of FILTER_KEYS) {
    const values = state.filters[key];
    if (!values?.length) continue;
    // A category name may hold a comma: each goes as its own parameter.
    if (key === "category") for (const v of values) p.append(key, v);
    else p.set(key, values.join(","));
  }
  const q = state.search.trim();
  if (q) p.set("q", q);
  return p;
}

export function itemsReportParams(state: ItemsReportState): string {
  const p = baseParams(state);
  p.set("sort", state.sort);
  p.set("dir", state.dir);
  p.set("page", String(state.page));
  p.set("pageSize", String(state.pageSize));
  return p.toString();
}

export function itemsExportParams(state: ItemsReportState): string {
  const p = baseParams(state);
  p.set("sort", state.sort);
  p.set("dir", state.dir);
  return p.toString();
}

/** One item's jobs: the same window and filters, the item's key, its own paging. */
export function itemJobsParams(state: ItemsReportState, item: string, page: number, pageSize: number): string {
  const p = baseParams(state);
  p.set("item", item);
  p.set("page", String(page));
  p.set("pageSize", String(pageSize));
  return p.toString();
}

/** Tick or untick one value of a filter group; an emptied group is dropped. */
export function toggleItemsFilter(filters: ItemsReportFilters, key: keyof ItemsReportFilters, value: string): ItemsReportFilters {
  const current = filters[key] ?? [];
  const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
  const out: ItemsReportFilters = { ...filters };
  if (next.length) out[key] = next;
  else delete out[key];
  return out;
}

/** A header click: the same column flips, another starts on its natural order (text A→Z, figures high→low). */
export function nextSort(current: { column: ItemsReportSort; dir: "asc" | "desc" }, column: ItemsReportSort) {
  if (current.column === column) return { column, dir: current.dir === "asc" ? ("desc" as const) : ("asc" as const) };
  const text = column === "item" || column === "model" || column === "category";
  return { column, dir: text ? ("asc" as const) : ("desc" as const) };
}

/* ------------------------------------------------------------------ cells */

export const money = (n: number | undefined): string =>
  typeof n === "number" ? n.toLocaleString("en-US", { style: "currency", currency: "USD" }) : "";

/** Units as Workiz prints them: two decimals, no float noise. */
export const unitsText = (n: number): string =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** `90.26% margin`. */
export const marginText = (n: number | undefined): string => (typeof n === "number" ? `${n.toFixed(2)}% margin` : "");

/** Under the name, grey: `#17011 - product`. */
export function itemSubline(row: { number?: number; type: string }): string {
  const parts = [row.number !== undefined ? `#${row.number}` : "", row.type].filter(Boolean);
  return parts.join(" - ");
}
