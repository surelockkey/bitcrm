import { ProductType } from '../enums/product-type.enum';
import { InventoryStatus } from '../enums/inventory-status.enum';

export interface Product {
  id: string;
  sku: string;
  barcode?: string;
  name: string;
  description?: string;
  category: string;
  type: ProductType;
  costCompany: number;
  costTech: number;
  priceClient: number;
  /** Default `taxable` flag copied onto job/estimate lines. Absent ⇒ `true`. */
  taxable?: boolean;
  supplier?: string;
  photoKey?: string;
  serialTracking: boolean;
  minimumStockLevel: number;
  status: InventoryStatus;
  createdAt: string;
  updatedAt: string;
}
