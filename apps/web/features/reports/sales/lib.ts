import {
  SALES_REPORT_COLUMNS,
  SALES_REPORT_MONEY_COLUMNS,
  type SalesReportBy,
  type SalesReportColumnId,
  type SalesReportFilters,
} from "@bitcrm/types";
import { JOBS_REPORT_BY_LABEL } from "@bitcrm/types";
import type { FieldOption } from "../jobs/components/jobs-report-fields";
import type { JobsReportPreset } from "../jobs/lib";

/*
 * The Workiz Sales report, web side: what the toolbar holds and the request
 * it makes of `GET /deals/report/sales`. The rows, the Total row, the chart,
 * the names, the sort and the paging all come from the server. The date
 * presets, the date cells and the money format are the Jobs report's.
 */

/** Workiz opens the report on this month, from the 1st to today. */
export const DEFAULT_SALES_PRESET: JobsReportPreset = "this_month";

/** Workiz's rows-per-page choices; 10 is its default. */
export const SALES_REPORT_PAGE_SIZES = [5, 10, 20, 25, 50, 100] as const;
export const DEFAULT_SALES_PAGE_SIZE = 10;

/** Workiz's labels for the "By:" dropdown — the Jobs report's three. */
export const SALES_REPORT_BY_LABEL: Record<SalesReportBy, string> = {
  created: JOBS_REPORT_BY_LABEL.created,
  scheduled: JOBS_REPORT_BY_LABEL.scheduled,
  end: JOBS_REPORT_BY_LABEL.end,
};

export interface SalesReportState {
  by: SalesReportBy;
  from: string;
  to: string;
  filters: SalesReportFilters;
  search: string;
  sort: SalesReportColumnId;
  dir: "asc" | "desc";
  page: number;
  pageSize: number;
}

const FILTER_KEYS = [
  "status",
  "techId",
  "jobTypeId",
  "paymentStatus",
  "sourceId",
  "serviceAreaId",
] as const satisfies readonly (keyof SalesReportFilters)[];

/** The query both the page and the export send — the export adds its columns and no paging. */
function baseParams(state: SalesReportState): URLSearchParams {
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

export function salesReportParams(state: SalesReportState): string {
  const p = baseParams(state);
  p.set("page", String(state.page));
  p.set("pageSize", String(state.pageSize));
  return p.toString();
}

export function salesExportParams(state: SalesReportState, columns: readonly SalesReportColumnId[]): string {
  const p = baseParams(state);
  p.set("columns", columns.join(","));
  return p.toString();
}

/** Add a value to a group (a click on a status cell): never removes, never duplicates. */
export function addSalesFilter(filters: SalesReportFilters, key: keyof SalesReportFilters, value: string): SalesReportFilters {
  const current = (filters[key] ?? []) as string[];
  return current.includes(value) ? filters : ({ ...filters, [key]: [...current, value] } as SalesReportFilters);
}

/* ---------------------------------------------------------------- columns */

export const SALES_COLUMN_LABEL = new Map<SalesReportColumnId, string>(SALES_REPORT_COLUMNS.map((c) => [c.id, c.label]));

/** The Fields panel's list: every column in the report's order, the amounts marked. */
export const SALES_FIELDS: readonly FieldOption<SalesReportColumnId>[] = SALES_REPORT_COLUMNS.map((c) => ({
  id: c.id,
  label: c.label,
  money: c.money,
}));

export const isMoneyColumn = (c: SalesReportColumnId): boolean => SALES_REPORT_MONEY_COLUMNS.includes(c);

/** The chosen columns in the report's fixed order (Workiz does not reorder). */
export function inSalesOrder(columns: readonly SalesReportColumnId[]): SalesReportColumnId[] {
  return SALES_REPORT_COLUMNS.map((c) => c.id).filter((id) => columns.includes(id));
}

/**
 * A header click: the same column flips; a new one starts where people
 * look first — the newest, the most money — or A→Z for text.
 */
export function nextSalesSort(
  cur: { column: SalesReportColumnId; dir: "asc" | "desc" },
  column: SalesReportColumnId,
): { column: SalesReportColumnId; dir: "asc" | "desc" } {
  if (cur.column === column) return { column, dir: cur.dir === "asc" ? "desc" : "asc" };
  const newestFirst = isMoneyColumn(column) || column === "jobNumber" || column === "created" || column === "scheduled" || column === "end";
  return { column, dir: newestFirst ? "desc" : "asc" };
}

/** The chart's day label, as Workiz prints it: `09/01/26`. */
export function chartDayLabel(day: string): string {
  return `${day.slice(5, 7)}/${day.slice(8, 10)}/${day.slice(2, 4)}`;
}

/** Workiz's margin line under Profit: "80.58% margin". */
export function marginLabel(margin: number | undefined): string {
  return margin === undefined ? "" : `${Number(margin.toFixed(2))}% margin`;
}
