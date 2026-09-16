import { ProductType } from '../enums/product-type.enum';
import { InventoryStatus } from '../enums/inventory-status.enum';

/**
 * Workiz item types BitCRM has no equivalent for. Both are non-stockable, so
 * they import as `ProductType.SERVICE` with the original word kept in
 * `Product.workizType` — nothing is lost and no stock guard is weakened.
 * 9 items are `other` (770 job lines) and 1 is `hours` (1 job line).
 */
export const WORKIZ_SERVICE_TYPES = ['other', 'hours'] as const;
export type WorkizProductType = (typeof WORKIZ_SERVICE_TYPES)[number];

export interface Product {
  id: string;
  sku: string;
  barcode?: string;
  name: string;
  description?: string;
  category: string;
  type: ProductType;
  /**
   * The Workiz item type when it was neither `product` nor `service`
   * (`other`, `hours`). Present only on imported items; `type` is then
   * `service`. Read-only — the API never sets or clears it.
   */
  workizType?: string;
  costCompany: number;
  costTech: number;
  priceClient: number;
  supplier?: string;
  photoKey?: string;
  serialTracking: boolean;
  minimumStockLevel: number;
  status: InventoryStatus;
  createdAt: string;
  updatedAt: string;
}

/**
 * Attributes the importer adds that `Product` does not declare (`externalId`,
 * `taxable`, `manageStock`, `customAttributes`…). The inventory repository
 * carries them through reads, so an edit from the UI — which writes only the
 * fields it was given — cannot erase them. Read them off a product with a
 * cast; the typed fields always win.
 */
export type ProductWithExtras = Product & Record<string, unknown>;
