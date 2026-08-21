import { InventoryStatus } from '../enums/inventory-status.enum';

/**
 * The vehicle a container is mounted in. A container is the inventory location;
 * the van is the physical thing that carries it, so these travel together but
 * stay a separate shape — a container can exist before its van is known.
 */
export interface ContainerVan {
  /** Vehicle Identification Number. Free text: VINs vary by region and age. */
  vin?: string;
  make?: string;
  model?: string;
  year?: number;
  licensePlate?: string;
}

export interface Container {
  id: string;
  /**
   * Display name of the location, e.g. "(AZ) ELI SZENDER". Falls back to
   * `technicianName` when unset, so older containers still render.
   */
  name?: string;
  technicianId: string;
  technicianName: string;
  department: string;
  van?: ContainerVan;
  /** Template describing the loadout this container should carry. */
  templateId?: string;
  status: InventoryStatus;
  createdAt: string;
  updatedAt: string;
}
