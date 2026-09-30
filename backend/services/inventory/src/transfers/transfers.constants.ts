/**
 * Transfers are listed off GSI1 (CategoryIndex), one partition per UTC month
 * of `createdAt` — the INVLOG pattern. Never the shared table's Scan (~46k
 * rows, a handful of them transfers: Scan+Limit filtered after the limit and
 * answered empty pages with a cursor, in hash order), and never one constant
 * partition (the CALL#ALL lesson: a hot key a busy year would outgrow).
 */
export const TRANSFERS_INDEX_PREFIX = 'TRANSFERS#';

/**
 * The oldest month any transfer is filed under — where the newest-first walk
 * stops, so an empty list costs one read and a count never guesses how far
 * back to go. `firstMonth` only ever moves down.
 */
export const TRANSFERS_FLOOR_KEY = { PK: 'TRANSFERS#INDEX', SK: 'METADATA' } as const;

export const MONTH_PATTERN = /^\d{4}-\d{2}$/;

/** The UTC month (`YYYY-MM`) a transfer is filed under. */
export function transferMonth(createdAt: string): string {
  return createdAt.slice(0, 7);
}

/** The month-index keys of one transfer row: time order, the id keeps two same-millisecond rows apart. */
export function transferIndexKeys(transfer: { id: string; createdAt: string }): {
  GSI1PK: string;
  GSI1SK: string;
} {
  return {
    GSI1PK: `${TRANSFERS_INDEX_PREFIX}${transferMonth(transfer.createdAt)}`,
    GSI1SK: `${transfer.createdAt}#${transfer.id}`,
  };
}
