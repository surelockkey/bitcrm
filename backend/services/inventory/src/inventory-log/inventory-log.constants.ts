/**
 * The inventory audit log lives in the shared BitCRM_Inventory table, one
 * partition per UTC month. Never a single constant partition: the whole
 * journal under one key is the CALL#ALL lesson — a hot partition and a
 * filtered Query that walks years to fill one page.
 */
export const INVLOG_PK_PREFIX = 'INVLOG#';
/** GSI4 (TransferEntityIndex) partition of one product's history. */
export const INVLOG_PRODUCT_PK_PREFIX = 'INVLOG#PRODUCT#';

/** The UTC month (`YYYY-MM`) an ISO timestamp falls in. */
export function invlogMonth(createdAt: string): string {
  return createdAt.slice(0, 7);
}

export function invlogPartition(month: string): string {
  return `${INVLOG_PK_PREFIX}${month}`;
}

/** Time order inside a partition; the id suffix keeps two same-millisecond rows apart. */
export function invlogSortKey(createdAt: string, id: string): string {
  return `${createdAt}#${id}`;
}

export function invlogProductPartition(productId: string): string {
  return `${INVLOG_PRODUCT_PK_PREFIX}${productId}`;
}

/**
 * What the `search` filter runs `contains` against: the item's name and SKU,
 * or — on an item-less entry (`container_assigned`) — the subject user's name.
 */
export function invlogSearchText(name: string | undefined, sku?: string): string {
  return [name, sku].filter(Boolean).join(' ').toLowerCase();
}

// The month helpers live with the walk that uses them; re-exported for the log's callers.
export { previousMonth, monthsDescending } from '../common/utils/month-walk';
