import { InventoryStatus } from '../enums/inventory-status.enum';

export interface Warehouse {
  id: string;
  name: string;
  address?: string;
  description?: string;
  status: InventoryStatus;
  createdAt: string;
  updatedAt: string;
}
