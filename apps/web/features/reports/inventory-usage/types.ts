import type { InventoryLogEntry } from "@bitcrm/types";

/**
 * The Inventory Usage report's responses, as this page reads them.
 *
 * Local on purpose: the report endpoints are being built alongside this page
 * (backend/inventory-report), and their final shapes land in @bitcrm/types
 * with them. Everything the server may leave out is optional here, and the
 * page renders "—" rather than trusting a field to be there.
 */

/** The three tabs, in Workiz's order. */
export type ReportTab = "usage" | "returns" | "log";

/**
 * One line of a job's inventory items (`GET /inventory/reports/inventory-usage`).
 * Workiz shows one row per line, not per (item, job): the same item twice in a
 * job at two prices is two rows.
 */
export interface InventoryUsageRow {
  dealId: string;
  dealNumber?: string | number;
  /** The job's scheduled day — the date the tab's range is on (YYYY-MM-DD or ISO). */
  jobDate?: string;
  clientName?: string;
  techIds?: string[];
  /** Resolved by the server when it can; otherwise the page names `techIds` itself. */
  techNames?: string[] | string;
  productId: string;
  productName?: string;
  sku?: string;
  /** The item's number in the catalog, when it has one. */
  number?: string;
  category?: string;
  brandId?: string;
  qty: number;
  /** Price per unit on the job. */
  unitPrice?: number;
  /** Company cost per unit — absent without `financials.view`. */
  unitCost?: number;
  /** qty × unitPrice. */
  total?: number;
  /** `workiz`: carried over by the import, not written by BitCRM. */
  source?: "bitcrm" | "workiz";
}

/**
 * An inventory log entry as the Returns and Action log tabs read it. The job
 * number may come with the entry; when it doesn't, the page resolves it from
 * `dealId`.
 */
export type ReportLogEntry = InventoryLogEntry & {
  dealNumber?: string | number;
  source?: "bitcrm" | "workiz";
};

/** A row of whichever tab is on screen. */
export type ReportRow = InventoryUsageRow | ReportLogEntry;

/**
 * `GET …/inventory-usage/summary` → `{ rows, qty, total?, cost?, atLeast? }`.
 * `total` is Σ qty × price and `cost` is Σ qty × cost — not Workiz's sum of
 * unit prices. Money is absent without `financials.view`.
 */
export interface UsageSummary {
  rows: number;
  qty: number;
  total?: number;
  cost?: number;
  /** The count stopped at its ceiling: the real numbers are higher. */
  atLeast?: boolean;
}

/** `GET …/inventory-returns/summary` → `{ rows, qty, atLeast? }`. */
export interface ReturnsSummary {
  rows: number;
  qty: number;
  atLeast?: boolean;
}

/**
 * What the page keeps of a tab's summary: the row count for the pager and the
 * totals for the Totals row. The Action log has no totals — only its count
 * (`GET /inventory/inventory-log/count` → `{ total, atLeast }`).
 */
export interface ReportSummary {
  rows?: number;
  qty?: number;
  total?: number;
  cost?: number;
  atLeast?: boolean;
}

/** The "Filter results" picks — several per group, as in Workiz. */
export interface ReportFilters {
  techIds: string[];
  locationIds: string[];
  /** Category names — items carry their category by name. */
  categories: string[];
  brandIds: string[];
}

/** Everything a tab's request is built from. */
export interface ReportQuery {
  /** YYYY-MM-DD, inclusive. */
  from: string;
  to: string;
  filters: ReportFilters;
  search?: string;
}
