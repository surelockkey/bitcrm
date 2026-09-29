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

/** What the `search` filter runs `contains` against. */
export function invlogSearchText(productName: string, sku?: string): string {
  return [productName, sku].filter(Boolean).join(' ').toLowerCase();
}

export function previousMonth(month: string): string {
  const [year, mon] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, mon - 2, 1));
  return date.toISOString().slice(0, 7);
}

/** Every month from `to` back to `from`, both included; empty when `from` is later. */
export function monthsDescending(from: string, to: string): string[] {
  const months: string[] = [];
  for (let month = to; month >= from; month = previousMonth(month)) {
    months.push(month);
  }
  return months;
}
