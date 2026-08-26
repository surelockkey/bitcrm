import { InventoryStatus } from '../enums/inventory-status.enum';

/**
 * A mobile stock location (a van/truck). Created manually; a technician may be
 * assigned to it (and reassigned or removed) — the container is not derived
 * from the technician.
 */
export interface Container {
  id: string;
  name: string;
  description?: string;
  /** Assigned technician, if any. */
  technicianId?: string;
  /** Denormalized snapshot of the assigned technician's name. */
  technicianName?: string;
  department?: string;
  status: InventoryStatus;
  createdAt: string;
  updatedAt: string;
}
