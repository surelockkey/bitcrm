import { InventoryStatus } from '../enums/inventory-status.enum';
import { LocationSummaryType } from './location-summary.entity';

/** One row of the product stock popup: a location and how many of the item it holds. */
export interface ProductLocationStock {
  locationType: LocationSummaryType;
  locationId: string;
  name: string;
  description?: string;
  status: InventoryStatus;
  /** 0 when the item was never moved into this location. */
  quantity: number;
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
