import { INBOX_MIN_YEAR } from './constants/dynamo.constants';

/**
 * Cursor state for a year-bucketed listing: the year being read and, when
 * DynamoDB stopped mid-partition, the key to resume from.
 */
export interface YearWalkCursor {
  y: string;
  k?: Record<string, unknown>;
}

export interface YearWalkPage<T> {
  items: T[];
  lastEvaluatedKey?: Record<string, unknown>;
}

export interface YearWalkOptions<T> {
  /** Year to start from on a fresh listing (normally the current year). */
  startYear: string;
  /** Stop walking below this year. Defaults to INBOX_MIN_YEAR. */
  minYear?: number;
  limit: number;
  cursor?: YearWalkCursor;
  /** Runs one Query against the partition for `year`. */
  query: (
    year: string,
    exclusiveStartKey: Record<string, unknown> | undefined,
    limit: number,
  ) => Promise<YearWalkPage<T>>;
}

export const yearNow = (now: Date = new Date()) => String(now.getUTCFullYear());

/**
 * Fills one page across year partitions, newest year first (design §3.3 A1):
 * read `<year>`; when it runs dry before the page is full, continue in
 * `<year-1>`, down to `minYear`. Each step is a key-condition-only Query, so
 * an empty year costs one cheap round trip and a hot inbox never scans.
 *
 * Returns a cursor when there may be more: either a resume key inside the
 * current year or just the next year to read.
 */
export async function walkYears<T>(opts: YearWalkOptions<T>): Promise<{
  items: T[];
  nextCursor?: YearWalkCursor;
}> {
  const minYear = opts.minYear ?? INBOX_MIN_YEAR;
  const items: T[] = [];
  let year = opts.cursor?.y ?? opts.startYear;
  let startKey = opts.cursor?.k;

  while (items.length < opts.limit && Number(year) >= minYear) {
    const page = await opts.query(year, startKey, opts.limit - items.length);
    items.push(...page.items);

    if (page.lastEvaluatedKey) {
      // DynamoDB stopped at Limit inside this partition — resume right there.
      return { items, nextCursor: { y: year, k: page.lastEvaluatedKey } };
    }

    year = String(Number(year) - 1);
    startKey = undefined;
    if (Number(year) < minYear) break;
    if (items.length >= opts.limit) return { items, nextCursor: { y: year } };
  }

  return { items };
}
