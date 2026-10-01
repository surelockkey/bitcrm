import type { TimelineEntry } from '@bitcrm/types';

/** The order GSI10 sorts a client's history in: newest first by timestamp, then id. */
export const historyKey = (row: { timestamp: string; id: string }) => `${row.timestamp}#${row.id}`;

export interface MergeBounds {
  /** The key of the last row the previous page showed — exclusive upper bound. */
  after?: string;
  /** Whether a further page of job events follows this one. */
  hasMore: boolean;
}

/**
 * Slot the import's client-level events (created / deleted — a handful per
 * client, read whole every time) into one page of the jobs' events, newest
 * first, each exactly once across the pages:
 *
 *   - never a row at or above `after` (the previous page had it);
 *   - while more pages follow, only rows down to this page's oldest event
 *     (older ones wait for the page they fall in);
 *   - on the last page, everything that is left — "Created client" closes
 *     the list.
 *
 * An empty page that is not the last has no lower bound, so it takes nothing.
 * The page may come out a few rows longer than the limit asked for.
 */
export function mergeClientEvents(
  page: TimelineEntry[],
  clientRows: TimelineEntry[],
  bounds: MergeBounds,
): TimelineEntry[] {
  if (!clientRows.length) return page;
  const floor = page.length ? historyKey(page[page.length - 1]) : undefined;
  if (bounds.hasMore && floor === undefined) return page;
  const picked = clientRows.filter((row) => {
    const key = historyKey(row);
    if (bounds.after !== undefined && key >= bounds.after) return false;
    return !bounds.hasMore || key >= (floor as string);
  });
  if (!picked.length) return page;
  return [...page, ...picked].sort((a, b) => (historyKey(a) < historyKey(b) ? 1 : historyKey(a) > historyKey(b) ? -1 : 0));
}
