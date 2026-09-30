import { InventoryStatus } from '../enums/inventory-status.enum';
import { LocationStockTotals } from './location-summary.entity';

export interface Warehouse extends LocationStockTotals {
  id: string;
  name: string;
  address?: string;
  description?: string;
  status: InventoryStatus;
  /** A Workiz placeholder for a location deleted in Workiz. Never listed; still readable by id. */
  placeholder?: boolean;
  createdAt: string;
  updatedAt: string;
}
