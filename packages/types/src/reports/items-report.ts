import { type JobsReportPagination } from './jobs-report';

/**
 * The Workiz "Items and services" report (`/root/itemsReport`), shared by
 * deal-service (`GET /deals/report/items`, `/items/jobs`, `/items/export`)
 * and the web page.
 *
 * One row per price-book item: how many units of it the period's jobs sold,
 * for how much, at what cost and profit, on how many jobs. Checked live on
 * 2026-09-29 (`workiz-data-parser/docs/reports/items-and-services.md`):
 *
 * - only **Done** jobs count, on their **job date** (the visit's start), days
 *   on the account's calendar (America/New_York), both ends included;
 * - a job's service fee (`SERVICE_FEE_TYPE`) and discount (`DISCOUNT_TYPE`)
 *   lines are not items and never count;
 * - Price = Σ(qty × price), Cost = Σ(qty × cost), Profit = Price − Cost,
 *   margin = Profit / Price; quantities may be fractional (3.1 hours);
 * - the Total row sums the unrounded lines and prints two decimals (Workiz
 *   prints its float as is: `6597.849999999999`).
 */

/**
 * Workiz's "ITEM TYPE" filter, in its order. The values are the words Workiz
 * keeps on a line (`product`, `service`…), matched exactly — Workiz's own
 * `other` items (shown as `#id - other`) are caught by none of them, as there.
 */
export const ITEMS_REPORT_ITEM_TYPES = [
  { id: 'product', label: 'Product' },
  { id: 'service', label: 'Service' },
  { id: 'hours', label: 'Hours' },
  { id: 'expense', label: 'Expense' },
  { id: 'equipment', label: 'Equipment' },
  { id: 'warranty', label: 'Warranty' },
] as const;

export type ItemsReportItemType = (typeof ITEMS_REPORT_ITEM_TYPES)[number]['id'];

/**
 * The table's columns in Workiz's order, with the header Workiz's CSV gives
 * each (the on-screen "Model #" is "SKU" in the file). All are always shown.
 */
export const ITEMS_REPORT_COLUMNS = [
  { id: 'item', label: 'Item', csv: 'Item', money: false },
  { id: 'model', label: 'Model #', csv: 'SKU', money: false },
  { id: 'units', label: 'Units', csv: 'Units', money: false },
  { id: 'category', label: 'Category', csv: 'Category', money: false },
  { id: 'price', label: 'Price', csv: 'Price', money: true },
  { id: 'cost', label: 'Cost', csv: 'Cost', money: true },
  { id: 'profit', label: 'Profit', csv: 'Profit', money: true },
  { id: 'jobs', label: 'Jobs', csv: 'Jobs', money: false },
] as const;

export type ItemsReportColumnId = (typeof ITEMS_REPORT_COLUMNS)[number]['id'];

/**
 * What the report sorts on: any column, or `number` — the item's number,
 * Workiz's default (`item_id desc`: the newest items first).
 */
export const ITEMS_REPORT_SORTS = ['number', 'item', 'model', 'units', 'category', 'price', 'cost', 'profit', 'jobs'] as const;
export type ItemsReportSort = (typeof ITEMS_REPORT_SORTS)[number];

/** Rows per page the server accepts. Workiz offers 5, 10, 20, 25, 50 (default) and 100. */
export const ITEMS_REPORT_MAX_PAGE_SIZE = 1000;
/** The longest period one request may cover — "Last year" is the longest preset. */
export const ITEMS_REPORT_MAX_DAYS = 366;

/**
 * The multi-filter ("Filter results"): OR inside a group, AND between groups.
 */
export interface ItemsReportFilters {
  /** Item types — the words of `ITEMS_REPORT_ITEM_TYPES`. */
  type?: string[];
  jobTypeId?: string[];
  /** Price-book categories, by name (as the price book spells them). */
  category?: string[];
  /** Users the line was sold by. */
  soldBy?: string[];
}

/** One price-book item over the period. */
export interface ItemsReportRow {
  /**
   * The row's id within the report — the product id, or a stand-in for a
   * line whose product is unknown. Sent back as `item` for the row's jobs.
   */
  key: string;
  productId?: string;
  /** The item's number (Workiz item id / price-book Product ID), printed `#<number>`. */
  number?: number;
  name: string;
  /** Workiz's word for the item's type: product, service, other, hours… */
  type: string;
  /** Model # — the item's model / serial number. */
  model?: string;
  category?: string;
  units: number;
  /** Absent without `financials.view`, as the other money below. */
  price?: number;
  cost?: number;
  profit?: number;
  /** Profit / Price × 100, two decimals; 0 when Price is 0. */
  margin?: number;
  /** Distinct Done jobs of the period with the item on them. */
  jobs: number;
  /** True when one of those jobs is under a service plan (Workiz "Service Plan"). */
  servicePlan: boolean;
}

/** Workiz's first, bold row. */
export interface ItemsReportTotals {
  /** How many items (rows) — Workiz's `counter`. */
  items: number;
  units: number;
  price?: number;
  cost?: number;
  profit?: number;
  margin?: number;
}

export type ItemsReportPagination = JobsReportPagination;

export interface ItemsReportPage {
  rows: ItemsReportRow[];
  totals: ItemsReportTotals;
  pagination: ItemsReportPagination;
  window: { from: string; to: string };
  sort: { column: ItemsReportSort; dir: 'asc' | 'desc' };
  /** False when money is withheld from this caller (no `financials.view`). */
  money: boolean;
  /**
   * Filter values only the period knows: the categories of its items and the
   * people who sold them (with names), whatever the filters currently hold.
   */
  options: { categories: string[]; soldBy: { id: string; name: string }[] };
}

/** One job of an item's drill-down — its lines of that item merged. */
export interface ItemsReportJobRow {
  dealId: string;
  jobNumber: string;
  jobSerial?: number;
  /** Account wall clock: `YYYY-MM-DDTHH:MM`, or `YYYY-MM-DD` for an all-day visit. */
  jobDate?: string;
  contactId: string;
  client: string;
  clientCompany?: string;
  units: number;
  price?: number;
  cost?: number;
  profit?: number;
  margin?: number;
  servicePlan: boolean;
  soldBy: { id: string; name: string }[];
}

export interface ItemsReportJobsPage {
  /** The item the jobs are of, over the same period and filters; null when it has none. */
  item: ItemsReportRow | null;
  rows: ItemsReportJobRow[];
  pagination: ItemsReportPagination;
  money: boolean;
}
