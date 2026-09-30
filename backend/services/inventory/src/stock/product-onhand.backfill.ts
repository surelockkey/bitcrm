/** The attributes of a stored row the onHand backfill sums. */
export interface StockSumRow {
  PK: string;
  SK: string;
  productId?: unknown;
  quantity?: unknown;
}

const LOCATION_PREFIXES = ['WAREHOUSE#', 'CONTAINER#'];
const STOCK_PREFIX = 'STOCK#';

/**
 * Units of each product across every warehouse and container: the `onHand`
 * StockRepository keeps on the product row, computed once for rows written
 * before the attribute existed. Rows that are not location stock are skipped
 * and an unreadable quantity counts as zero. Pure, so it is testable without
 * DynamoDB.
 */
export function sumOnHand(rows: StockSumRow[]): Map<string, number> {
  const totals = new Map<string, number>();

  for (const row of rows) {
    if (!LOCATION_PREFIXES.some((p) => row.PK.startsWith(p))) continue;
    if (!row.SK.startsWith(STOCK_PREFIX)) continue;

    const productId =
      typeof row.productId === 'string' && row.productId
        ? row.productId
        : row.SK.slice(STOCK_PREFIX.length);
    const quantity = Number(row.quantity) || 0;
    totals.set(productId, (totals.get(productId) ?? 0) + quantity);
  }

  return totals;
}
