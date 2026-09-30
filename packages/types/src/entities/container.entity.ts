import { InventoryStatus } from '../enums/inventory-status.enum';
import { LocationStockTotals } from './location-summary.entity';

/**
 * A mobile stock location (a van/truck). Created manually. Who works from it
 * is the user containers (`UserContainer`, many users per container); the
 * `technicianId` here is the legacy single-technician link, still accepted
 * and read only for users without an assignment row.
 */
export interface Container extends LocationStockTotals {
  id: string;
  name: string;
  description?: string;
  /** Legacy single technician, if any — see `UserContainer` for who works from the van. */
  technicianId?: string;
  /** Denormalized snapshot of the assigned technician's name. */
  technicianName?: string;
  department?: string;
  /** The container template describing this van's ideal loadout, if one is chosen. */
  templateId?: string;
  status: InventoryStatus;
  /**
   * A Workiz placeholder for a location deleted in Workiz (archived, imported
   * so history resolves). Never listed; still readable by id.
   */
  placeholder?: boolean;
  createdAt: string;
  updatedAt: string;
}
