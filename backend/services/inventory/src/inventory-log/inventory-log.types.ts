import { type InventoryLogEntry } from '@bitcrm/types';

/**
 * What an entry keeps of its item besides the name and SKU — snapshots taken
 * when it was written, which the report filters (item category, brand) and
 * the "Product ID" column read. Kept local to the service: the web defines a
 * matching type, and `@bitcrm/types` gains the fields when they settle.
 */
export interface InventoryLogItemSnapshot {
  /** The item's category NAME (`Product.category`) at the time. */
  category?: string;
  brandId?: string;
  /** The short "Product ID". */
  number?: number;
}

/** A stored log entry: the shared type plus the item snapshots. */
export type InventoryLogRecord = InventoryLogEntry & InventoryLogItemSnapshot;

/** The snapshot fields a product carries, the absent ones left out. */
export function itemSnapshot(
  product: { category?: string; brandId?: string; number?: number } | null | undefined,
): InventoryLogItemSnapshot {
  if (!product) return {};
  return {
    ...(product.category !== undefined && { category: product.category }),
    ...(product.brandId !== undefined && product.brandId !== null && { brandId: product.brandId }),
    ...(product.number !== undefined && product.number !== null && { number: product.number }),
  };
}
