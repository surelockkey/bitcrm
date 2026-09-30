import { transferIndexKeys, transferMonth } from './transfers.constants';

/** The attributes of a stored row the month index is derived from. */
export interface TransferIndexRow {
  PK: string;
  SK: string;
  id?: unknown;
  createdAt?: unknown;
  GSI1PK?: unknown;
  GSI1SK?: unknown;
}

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T/;

/**
 * The month-index keys this transfer row should carry, or null when it
 * already does — or is not a transfer row (a destination reference, the
 * floor row, anything else), or has no `createdAt` to be filed by. Pure, so
 * the backfill's decision is testable without DynamoDB.
 */
export function transferIndexKeysToWrite(row: TransferIndexRow): { GSI1PK: string; GSI1SK: string } | null {
  if (!row.PK.startsWith('TRANSFER#') || row.SK !== 'METADATA') return null;
  if (typeof row.createdAt !== 'string' || !ISO_TIMESTAMP.test(row.createdAt)) return null;

  const id = typeof row.id === 'string' && row.id ? row.id : row.PK.slice('TRANSFER#'.length);
  const keys = transferIndexKeys({ id, createdAt: row.createdAt });
  if (row.GSI1PK === keys.GSI1PK && row.GSI1SK === keys.GSI1SK) return null;
  return keys;
}

/** The oldest UTC month among these timestamps — the walk's floor. */
export function earliestMonth(createdAts: string[]): string | undefined {
  let earliest: string | undefined;
  for (const createdAt of createdAts) {
    const month = transferMonth(createdAt);
    if (earliest === undefined || month < earliest) earliest = month;
  }
  return earliest;
}
