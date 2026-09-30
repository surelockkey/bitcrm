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
