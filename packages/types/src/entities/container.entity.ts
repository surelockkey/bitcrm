import { InventoryStatus } from '../enums/inventory-status.enum';

/**
 * A mobile stock location (a van/truck). Created manually. Who works from it
 * is the user containers (`UserContainer`, many users per container); the
 * `technicianId` here is the legacy single-technician link, still accepted
 * and read only for users without an assignment row.
 */
export interface Container {
  id: string;
  name: string;
  description?: string;
  /** Legacy single technician, if any — see `UserContainer` for who works from the van. */
  technicianId?: string;
  /** Denormalized snapshot of the assigned technician's name. */
  technicianName?: string;
  department?: string;
  status: InventoryStatus;
  createdAt: string;
  updatedAt: string;
}
