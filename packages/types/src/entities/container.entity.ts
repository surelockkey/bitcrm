import { InventoryStatus } from '../enums/inventory-status.enum';

export interface Container {
  id: string;
  technicianId: string;
  technicianName: string;
  department: string;
  status: InventoryStatus;
  createdAt: string;
  updatedAt: string;
}
