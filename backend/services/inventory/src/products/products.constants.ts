/**
 * What the product list's `search` filter runs `contains` against. DynamoDB
 * compares bytes, so both sides are lowercased: the term at query time, the
 * name and SKU once, on the row (`searchName`, `searchSku`) — the way the
 * warehouses, containers and the inventory log already search. Rows written
 * before the attributes existed get them from `backfill:product-search`.
 */
export function productSearchName(name: string): string {
  return name.trim().toLowerCase();
}

export function productSearchSku(sku: string): string {
  return sku.trim().toLowerCase();
}

/**
 * Workiz's "All Stock Levels" box on its inventory list: `stocked` — more on
 * hand than the item's re-order point (`reorderLevel`, none = 0); `low` — at
 * or under it, nothing on hand included. The two split the stock-managed
 * items between them (Workiz: 1 888 + 1 218 = 3 106).
 */
export const PRODUCT_STOCK_LEVELS = ['stocked', 'low'] as const;
export type ProductStockLevel = (typeof PRODUCT_STOCK_LEVELS)[number];
