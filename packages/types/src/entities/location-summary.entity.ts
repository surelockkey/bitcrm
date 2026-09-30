import { InventoryStatus } from '../enums/inventory-status.enum';

/** A stock location that can hold items: a warehouse or a container, never the supplier pseudo-location. */
export type LocationSummaryType = 'warehouse' | 'container';

/**
 * The part of a warehouse or container the stock views need — what the
 * product stock popup lists and what a transfer form names on each side.
 */
export interface LocationSummary {
  type: LocationSummaryType;
  id: string;
  name: string;
  description?: string;
  /** The container's assigned technician — what an `assigned_only` scope keys on. Containers only. */
  technicianId?: string;
  /** What a `department` scope keys on. Containers only. */
  department?: string;
  status: InventoryStatus;
}
