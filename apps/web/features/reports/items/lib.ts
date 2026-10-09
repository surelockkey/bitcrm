import {
  ITEMS_REPORT_ITEM_TYPES,
  ITEMS_REPORT_MAX_DAYS,
  type ItemsReportFilters,
  type ItemsReportPagination,
  type ItemsReportSort,
  type ItemsReportTotals,
} from "@bitcrm/types";
import type { WzDateRange } from "@/components/workiz/date-range-picker";
import type { WzFilterGroup } from "@/components/workiz/grouped-filter";
import type { WzPagerState } from "@/components/workiz/pager";
import { JOBS_REPORT_PRESETS, presetRange, type JobsReportPreset } from "../jobs/lib";

/*
 * The Workiz Items and services report, web side: what the toolbar holds,
 * the requests it makes of `GET /deals/report/items` (and `/items/jobs`,
 * `/items/export`), the date presets and the printed cells. Rows, totals,
 * sort and paging come from the server.
 */

/* ---------------------------------------------------------------- presets */

/**
 * Workiz's presets on this report (checked live 2026-09-29 and again
 * 2026-10-09, rep_items_wz_06_date_open): the Jobs report's fifteen in the
 * same words plus "Last 3 months" — not the Payments report's twenty (no
 * six / twelve months, All time or Recent).
 */
export const ITEMS_REPORT_PRESETS = [
  ...JOBS_REPORT_PRESETS,
  { id: "last_3_months", label: "Last 3 months" },
] as const;

export type ItemsReportPreset = JobsReportPreset | "last_3_months";

/** Workiz opens this report on This month. */
export const DEFAULT_ITEMS_PRESET: Exclude<ItemsReportPreset, "custom"> = "this_month";

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

/**
 * A header click, as react-table makes it (rep_items_wz_15_sort_*): the same
 * column turns round, any other starts ascending — figures too.
 */
export function nextSort(current: { column: ItemsReportSort; dir: "asc" | "desc" }, column: ItemsReportSort) {
  if (current.column === column) return { column, dir: current.dir === "asc" ? ("desc" as const) : ("asc" as const) };
  return { column, dir: "asc" as const };
}

/**
 * Workiz's Custom rule (rep_items_wz_16g_custom_over_year): at most twelve
 * months, refused inside the date box and never asked of the server.
 */
export function itemsCustomCheck(range: WzDateRange): { usable: boolean; error: string | null } {
  if (range.preset !== "custom") return { usable: true, error: null };
  if (!range.from || !range.to) return { usable: false, error: null };
  const days = (Date.parse(`${range.to}T00:00:00Z`) - Date.parse(`${range.from}T00:00:00Z`)) / 86_400_000 + 1;
  if (days > ITEMS_REPORT_MAX_DAYS) return { usable: false, error: "Date range exceeds 12 months" };
  return { usable: true, error: null };
}

/* ----------------------------------------------------------------- filter */

/**
 * The chips' order: Workiz's filters object (`{type, jobType, sold_by,
 * category}`), not the menu's.
 */
export const ITEMS_FILTER_CHIP_ORDER = ["type", "jobTypeId", "soldBy", "category"] as const satisfies readonly (keyof ItemsReportFilters)[];

/**
 * "Filter results" (rep_items_wz_05_filter_open; the 09-29 live_filters
 * capture for CATEGORY): ITEM TYPE, JOB TYPE, CATEGORY, SOLD BY, side by
 * side, each chip keyed by Workiz's filters object ("type: Service",
 * "jobType: …", "category: …", "sold_by: …"). Workiz lists every category of
 * its catalog and every user; so do we — the price book's categories, the
 * directory (by name, Workiz's names) — and keep whatever the period itself
 * holds that those lists lack (an archived category, a seller the directory
 * cannot show).
 */
export function itemsFilterGroups({
  jobTypes,
  categories,
  periodCategories,
  people,
  periodSellers,
}: {
  jobTypes: { id: string; name: string }[];
  categories: string[];
  periodCategories: string[];
  people: { id: string; name: string }[];
  periodSellers: { id: string; name: string }[];
}): WzFilterGroup<keyof ItemsReportFilters>[] {
  const names = [...new Set([...categories, ...periodCategories])];
  const known = new Set(people.map((p) => p.id));
  const sellers = [
    ...[...people].sort((a, b) => a.name.localeCompare(b.name)),
    ...periodSellers.filter((p) => !known.has(p.id)),
  ];
  return [
    { key: "type", label: "Item Type", chip: "type", options: ITEMS_REPORT_ITEM_TYPES.map((t) => ({ value: t.id, label: t.label })) },
    { key: "jobTypeId", label: "Job type", chip: "jobType", options: jobTypes.map((t) => ({ value: t.id, label: t.name })) },
    { key: "category", label: "Category", chip: "category", options: names.map((c) => ({ value: c, label: c })) },
    { key: "soldBy", label: "Sold By", chip: "sold_by", options: sellers.map((p) => ({ value: p.id, label: p.name })) },
  ];
}

/* ------------------------------------------------------------------ pager */

/**
 * The server's page as Workiz's footer reads it: "Showing 11 to 20 of 147
 * results" counts items (the Total row is not one), "Page 2 of 15", at
 * least page 1 of 1.
 */
export function itemsPager(p: ItemsReportPagination, go: (page: number) => void, fetching: boolean): WzPagerState {
  const pages = Math.max(1, p.pages);
  return {
    page: p.page,
    from: p.from,
    to: p.to,
    total: p.total,
    totalPages: pages,
    canPrev: p.page > 1,
    canNext: p.page < pages,
    isFetching: fetching,
    prev: () => go(Math.max(1, p.page - 1)),
    next: () => go(Math.min(pages, p.page + 1)),
  };
}

/* ------------------------------------------------------------------ cells */

export const money = (n: number | undefined): string =>
  typeof n === "number" ? n.toLocaleString("en-US", { style: "currency", currency: "USD" }) : "";

/** Units as Workiz prints them ("1.00", "1382.00"): two decimals, no separators, no float noise. */
export const unitsText = (n: number): string => n.toFixed(2);

/** The Total row's units — blank when no item is listed, as Workiz's null. */
export const totalUnitsText = (t: Pick<ItemsReportTotals, "items" | "units">): string => (t.items === 0 ? "" : unitsText(t.units));

/**
 * `90.26% margin`. Given the profit, a row that made none prints Workiz's
 * `0% margin` (it sends an integer 0 for those), whatever the ratio says.
 */
export function marginText(margin: number | undefined, profit?: number): string {
  if (typeof margin !== "number") return "";
  if (typeof profit === "number" && profit <= 0) return "0% margin";
  return `${margin.toFixed(2)}% margin`;
}

/** The drill-down's Service Plan column: Workiz prints the boolean itself. */
export const servicePlanText = (on: boolean): string => (on ? "true" : "false");

/** Under the name, grey: `#17011 - product`. */
export function itemSubline(row: { number?: number; type: string }): string {
  const parts = [row.number !== undefined ? `#${row.number}` : "", row.type].filter(Boolean);
  return parts.join(" - ");
}
