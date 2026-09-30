/**
 * The inventory-usage projection: one row per (job, product) — what the
 * "Inventory Usage" report lists. Owned by the inventory service, maintained
 * in the same request as the stock move it mirrors, and written for history
 * by the Workiz importer (WORKIZ_IMPORT.md §6).
 */

/** Who wrote a row: live stock moves, or the Workiz history import. */
export type UsageSource = 'bitcrm' | 'workiz';

/**
 * The job as deal-service saw it when it moved stock (or when it changed
 * the job). Every field but `dealNumber` is optional: an absent
 * `scheduledDate` means the job has no date, any other absent field keeps
 * what the row already holds.
 */
export interface UsageJob {
  dealNumber: string;
  /** `YYYY-MM-DD`. */
  scheduledDate?: string;
  /** The client's display name — the job's own override, else the contact's. */
  clientName?: string;
  contactId?: string;
  techIds?: string[];
  /** Aligned with `techIds`; absent when deal-service could not name them. */
  techNames?: string[];
}

/** A row's key. */
export interface UsageKey {
  PK: string;
  SK: string;
}

/** One projection row, as stored (minus the keys and `searchText`). */
export interface UsageRow {
  dealId: string;
  productId: string;
  /**
   * The job's scheduled date (`YYYY-MM-DD`) — what the report filters and
   * sorts by. A job without one files under the day of its first use, with
   * `jobDateMissing: true`.
   */
  jobDate: string;
  jobDateMissing?: boolean;
  dealNumber?: string;
  clientName?: string;
  contactId?: string;
  techIds: string[];
  techNames?: string[];
  productName: string;
  sku?: string;
  number?: number;
  /** Item category NAME at the time of the last use. */
  category?: string;
  brandId?: string;
  /** Net units used: uses minus restores. The report hides rows at 0 or below. */
  qty: number;
  /** Client price per unit — the job line's, else the catalog's, at the last use. */
  unitPrice?: number;
  /** Company cost per unit, same rule. */
  unitCost?: number;
  /** Every container units were taken from (a String Set in DynamoDB). */
  containerIds: string[];
  firstUsedAt: string;
  lastUsedAt: string;
  source: UsageSource;
}

/** A stored row with its key. */
export type StoredUsageRow = UsageRow & UsageKey;

/** What the item snapshot on a row comes from: the catalog product, if this service holds it. */
export interface UsageProductSnapshot {
  name?: string;
  sku?: string;
  number?: number;
  category?: string;
  brandId?: string;
  priceClient?: number;
  costCompany?: number;
}

/** One item of a job's stock use. */
export interface UsageUseItem {
  productId: string;
  productName: string;
  quantity: number;
  /** The job line's price / cost per unit, when deal-service sent them. */
  unitPrice?: number;
  unitCost?: number;
  /** The catalog product, when this service holds it. */
  product?: UsageProductSnapshot | null;
}

/** What `PUT /usage/internal/deals/:dealId/job` did. */
export interface UsageRekeyResult {
  /** Rows the job has. */
  rows: number;
  /** Rows filed under a new date (month / sort key). */
  moved: number;
  /** Rows rewritten in place (client or technicians changed). */
  updated: number;
}
