import { InventoryStatus } from '../enums/inventory-status.enum';
import { LocationStockTotals, LocationSummaryType } from './location-summary.entity';

/**
 * One row of the product stock popup: a location and how many of the item it
 * holds, plus the location's own totals (absent until backfilled).
 */
export interface ProductLocationStock extends LocationStockTotals {
  locationType: LocationSummaryType;
  locationId: string;
  name: string;
  description?: string;
  status: InventoryStatus;
  /** 0 when the item was never moved into this location. */
  quantity: number;
  /**
   * A Workiz placeholder location: listed only while it still holds this item
   * (quantity > 0), so no units become invisible.
   */
  placeholder?: boolean;
}

/**
 * A product's stock across every location — warehouses first, then containers,
 * each group in name order, inactive locations included.
 */
export interface ProductStock {
  productId: string;
  /** The sum over every location. */
  onHand: number;
  locations: ProductLocationStock[];
}

/** One product a location holds, with the catalog fields the stock popup shows. */
export interface LocationStockRow {
  productId: string;
  /** The catalog's name; the stock row's own snapshot when the product row is gone. */
  productName: string;
  /** Product ID ("number"), SKU, category and prices — absent when the product row is gone. */
  number?: number;
  sku?: string;
  category?: string;
  quantity: number;
  priceClient?: number;
  costCompany?: number;
  /** The product's minimum stock level — what a "Low stock" badge compares `quantity` against. */
  minimumStockLevel?: number;
}

/** Everything one warehouse or container holds (quantity > 0), sorted by product name. */
export interface LocationStock {
  locationType: LocationSummaryType;
  locationId: string;
  name: string;
  description?: string;
  status: InventoryStatus;
  placeholder?: boolean;
  rows: LocationStockRow[];
}
