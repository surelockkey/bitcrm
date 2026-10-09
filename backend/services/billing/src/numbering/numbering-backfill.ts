import type { AccountCountersRow, NumberingKind } from './numbering.repository';
import { lastUsed } from './numbering.service';

/** What `backfill:numbering` reads off a document row. */
export interface NumberedRow {
  number?: string;
  /** Set on a job's document — its number is the job's, never the counter's. */
  dealId?: string;
}

/**
 * The highest numeric number among the CLIENT documents (no job). A job's
 * document carries the job's number and an imported stub may carry Workiz's
 * coded serial — neither is a counter value. 0 when there is none.
 */
export function highestClientNumber(rows: Iterable<NumberedRow>): number {
  let max = 0;
  for (const row of rows) {
    if (row.dealId || !row.number || !/^\d{1,9}$/.test(row.number)) continue;
    max = Math.max(max, Number(row.number));
  }
  return max;
}

export interface NumberingRaise {
  kind: NumberingKind;
  from: number;
  to: number;
}

/**
 * Which counters stand below the documents and must be raised to the highest
 * number found; a counter already past it, or a kind with nothing numeric
 * found, is left alone. The legacy numbers count as handed out.
 */
export function planNumberingBackfill(
  row: AccountCountersRow,
  highest: Record<NumberingKind, number>,
): NumberingRaise[] {
  const out: NumberingRaise[] = [];
  for (const kind of ['invoice', 'estimate'] as const) {
    const from = lastUsed(row, kind);
    const to = highest[kind];
    if (to > from) out.push({ kind, from, to });
  }
  return out;
}
