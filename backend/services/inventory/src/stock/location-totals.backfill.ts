import { type LocationStockTotals } from '@bitcrm/types';

/** What the backfill computes for one location. */
export type LocationTotals = Required<LocationStockTotals>;

/** The totals attributes of a stored location row, as read (anything may be there). */
export interface StoredTotals {
  totalUnits?: unknown;
  uniqueItems?: unknown;
}

/** One DynamoDB update, minus the table and key. */
export interface TotalsWrite {
  UpdateExpression: string;
  ConditionExpression: string;
  ExpressionAttributeValues: Record<string, unknown>;
}

/**
 * Units across one location's STOCK# rows, and how many of them hold
 * something (quantity > 0) — what StockRepository keeps on the location row
 * with every stock write. A negative row (the Workiz import can bring one)
 * counts in the units but is not a product held; an unreadable quantity is 0.
 * Pure, so the backfill's arithmetic is testable without DynamoDB.
 */
export function sumLocationStock(rows: Array<{ quantity?: unknown }>): LocationTotals {
  let totalUnits = 0;
  let uniqueItems = 0;
  for (const row of rows) {
    const quantity = Number(row.quantity) || 0;
    totalUnits += quantity;
    if (quantity > 0) uniqueItems += 1;
  }
  return { totalUnits, uniqueItems };
}

/**
 * Before counting, a row with no totals gets zeros — `if_not_exists`, so a
 * total that is already kept is never touched. From then on every stock write
 * moves them in its own transaction, and a write landing between the count
 * and the reconcile write below changes the row and refuses that write
 * instead of being lost.
 */
export const LOCATION_TOTALS_SEED: TotalsWrite = {
  UpdateExpression:
    'SET totalUnits = if_not_exists(totalUnits, :zero), uniqueItems = if_not_exists(uniqueItems, :zero)',
  ConditionExpression: 'attribute_exists(PK)',
  ExpressionAttributeValues: { ':zero': 0 },
};

/**
 * The write that sets `actual` on a row that holds `seen`, or null when they
 * already agree. It is conditioned on the row still holding exactly `seen`
 * (a missing or non-numeric attribute pinned as missing): a stock write that
 * landed since the row was read moved the totals, and the reconcile must be
 * refused and redone rather than overwrite it.
 */
export function totalsReconcileWrite(seen: StoredTotals, actual: LocationTotals): TotalsWrite | null {
  const seenUnits = typeof seen.totalUnits === 'number' ? seen.totalUnits : undefined;
  const seenItems = typeof seen.uniqueItems === 'number' ? seen.uniqueItems : undefined;
  if (seenUnits === actual.totalUnits && seenItems === actual.uniqueItems) return null;

  const values: Record<string, unknown> = { ':units': actual.totalUnits, ':items': actual.uniqueItems };
  const conditions = ['attribute_exists(PK)'];
  if (seenUnits === undefined) {
    conditions.push('attribute_not_exists(totalUnits)');
  } else {
    conditions.push('totalUnits = :seenUnits');
    values[':seenUnits'] = seenUnits;
  }
  if (seenItems === undefined) {
    conditions.push('attribute_not_exists(uniqueItems)');
  } else {
    conditions.push('uniqueItems = :seenItems');
    values[':seenItems'] = seenItems;
  }

  return {
    UpdateExpression: 'SET totalUnits = :units, uniqueItems = :items',
    ConditionExpression: conditions.join(' AND '),
    ExpressionAttributeValues: values,
  };
}
