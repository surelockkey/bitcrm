/**
 * A filtered Scan does not return a page — it returns whatever survived the
 * filter out of the rows it happened to read.
 *
 * `Limit` caps rows **read**; `FilterExpression` is applied afterwards. In a
 * single-table design the two are worlds apart: after the Workiz import the
 * users table held 6,787 rows of which 585 were user records, so a request for
 * 100 users came back with nine. Every screen that resolves a name through the
 * directory then showed "Unknown technician" — the data was there, the page
 * simply stopped early.
 *
 * `scanPage` fills the page instead of requesting it: it reads on until it has
 * the rows the caller asked for, the table ends, or it has read enough times
 * to say "carry on from here" rather than walk a huge table inside one request.
 *
 * Use it wherever a Scan carries a FilterExpression. A Query on an index that
 * already selects the right rows needs none of this.
 */

export interface ScanReadInput {
  Limit: number;
  ExclusiveStartKey?: Record<string, unknown>;
}

export interface ScanReadOutput<T> {
  Items?: T[];
  LastEvaluatedKey?: Record<string, unknown>;
}

export interface ScanPageOptions<T> {
  /** Where the previous page stopped. */
  startKey?: Record<string, unknown>;
  /**
   * How many reads one request may cost. The default walks ~20× the page size
   * before handing a cursor back, which covers a table where one row in twenty
   * matches — beyond that, paging is the honest answer.
   */
  maxReads?: number;
  /**
   * The key of a row, used only when a read overshoots the page. Without it an
   * overshooting page is returned whole rather than cut, so no row is lost.
   */
  keyOf?: (item: T) => Record<string, unknown>;
}

export interface ScanPageResult<T> {
  items: T[];
  lastKey?: Record<string, unknown>;
}

/** Rows asked of DynamoDB per read, relative to the page: the filter will drop most of them. */
const READ_FACTOR = 10;
const DEFAULT_MAX_READS = 20;

export async function scanPage<T>(
  read: (input: ScanReadInput) => Promise<ScanReadOutput<T>>,
  limit: number,
  options: ScanPageOptions<T> = {},
): Promise<ScanPageResult<T>> {
  const { startKey, maxReads = DEFAULT_MAX_READS, keyOf } = options;
  const items: T[] = [];
  let key = startKey;
  let reads = 0;

  while (reads < maxReads) {
    const out = await read({
      Limit: Math.max(limit * READ_FACTOR, limit),
      ...(key ? { ExclusiveStartKey: key } : {}),
    });
    reads += 1;
    items.push(...(out.Items ?? []));
    key = out.LastEvaluatedKey;

    // The table ended: there is nothing to come back for, however short the page.
    if (!key) return { items, lastKey: undefined };
    if (items.length >= limit) break;
  }

  if (items.length <= limit) return { items, lastKey: key };

  // Overshot. Cut to the page and point the cursor at the last row kept, so the
  // next page resumes with the first row dropped instead of skipping it.
  const kept = items.slice(0, limit);
  return { items: kept, lastKey: keyOf ? keyOf(kept[kept.length - 1]) : key };
}
