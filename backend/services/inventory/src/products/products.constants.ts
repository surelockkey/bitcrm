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
 * Rows asked of one read on a filtered page of a product partition — the
 * Price Book (`PRODUCTS#ALL`, ~16k rows), the inventory products
 * (`PRODUCTS#STOCK`, ~3k) and a category (`CATEGORY#Uncategorized`, ~13k) —
 * whatever the page size. At a thousand rows DynamoDB's 1 MB page stops the
 * read first (~1 KB rows), so every read is as large as a read can be.
 */
export const PRODUCT_INDEX_READ_ROWS = 1000;

/**
 * Reads one filtered page — or one count — of a product partition may spend.
 * Each is at most 1 MB, so 40 cover a 40 MB / 40k-row partition: the ~16 MB
 * Price Book 2.5 times over, and a search that matches only its last rows
 * still answers on the first page. Past it the page is handed back with a
 * cursor, never lost.
 */
export const PRODUCT_INDEX_MAX_READS = 40;
