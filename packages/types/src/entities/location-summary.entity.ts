import { InventoryStatus } from '../enums/inventory-status.enum';

/** A stock location that can hold items: a warehouse or a container, never the supplier pseudo-location. */
export type LocationSummaryType = 'warehouse' | 'container';

/**
 * Stock totals the server keeps on a warehouse or container row, so a list
 * shows "how much is in there" without reading the location's stock.
 * Moved by every stock write in the same transaction as the stock row.
 * Both are absent on a row the `backfill:location-totals` script has not
 * reached yet — show "—" then, never compute them from the stock rows.
 */
export interface LocationStockTotals {
  /** Units across every product the location holds (Σ quantity of its stock rows). */
  totalUnits?: number;
  /** How many different products it holds (stock rows with quantity > 0). */
  uniqueItems?: number;
}

/**
 * The part of a warehouse or container the stock views need — what the
 * product stock popup lists and what a transfer form names on each side.
 */
export interface LocationSummary extends LocationStockTotals {
  type: LocationSummaryType;
  id: string;
  name: string;
  description?: string;
  /**
   * The container's legacy single technician. The `assigned_only` scope keys
   * on the user containers (`UserContainer`) now, and on this only for a user
   * who has no assignment row yet. Containers only.
   */
  technicianId?: string;
  /** What a `department` scope keys on. Containers only. */
  department?: string;
  status: InventoryStatus;
  /** A Workiz placeholder (a location deleted in Workiz): left out of every list. */
  placeholder?: boolean;
}
