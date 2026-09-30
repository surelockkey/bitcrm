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
  /**
   * Short sequential id, shown as "Product ID". Assigned by the inventory
   * service from its counter on create; imported rows carry the Workiz item
   * id. Never taken from a client.
   */
  number?: number;
  sku: string;
  /**
   * The SKU is an internal one: the item was saved without a SKU of its own
   * (Workiz lets SKU / Model # stay empty), so BitCRM gave it `ITEM-<number>`.
   * Screens show the field empty. Cleared when a SKU is typed in.
   */
  skuGenerated?: boolean;
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
  /** Default `taxable` flag copied onto job/estimate lines. Absent ⇒ `true`. */
  taxable?: boolean;
  supplier?: string;
  brandId?: string;
  photoKey?: string;
  serialTracking: boolean;
  minimumStockLevel: number;
  /**
   * Whether stock is counted for this product (Workiz `manage`). Absent ⇒
   * `true`; services are never stock-managed whatever the flag says.
   */
  manageStock?: boolean;
  /** Reorder point from the Workiz price book. */
  reorderLevel?: number;
  /**
   * Custom field values, keyed by the field's NAME (see `ItemAttribute`).
   * Only non-empty values are kept; a key no definition names any more (an
   * imported `workiz_attr_<id>`) is carried through untouched.
   */
  customAttributes?: Record<string, string>;
  /** Workiz "Add to booking items" (`in_booking`). Absent ⇒ false. */
  availableInBooking?: boolean;
  /** Workiz "Booking Price", used while `availableInBooking` is on. */
  bookingPrice?: number;
  /** Workiz "Show item on price book" (`price_book_enabled`). Absent ⇒ true. */
  priceBookEnabled?: boolean;
  /**
   * Units held across every warehouse and container. Maintained by the stock
   * writes; read-only through the API and never taken from a client.
   */
  onHand?: number;
  status: InventoryStatus;
  createdAt: string;
  updatedAt: string;
}

/**
 * Attributes the importer adds that `Product` does not declare (`externalId`,
 * `categoryId`, `jobTypeIds`…). The inventory repository
 * carries them through reads, so an edit from the UI — which writes only the
 * fields it was given — cannot erase them. Read them off a product with a
 * cast; the typed fields always win. `taxable`, `manageStock`, `brandId`,
 * `reorderLevel`, `customAttributes`, `availableInBooking`, `bookingPrice`
 * and `priceBookEnabled` used to live here and are typed on `Product` now.
 */
export type ProductWithExtras = Product & Record<string, unknown>;
