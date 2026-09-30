/**
 * How many rows a list holds — the number behind "Page 2 of 7".
 *
 * A cursor-paged list knows where it is, never how far it goes: DynamoDB hands
 * back a page and a key, not a size. The panel needs a total, and the only way
 * to get one is to count.
 *
 * `Select: 'COUNT'` is the cheap way to ask. No item bodies cross the wire, and
 * the charge is for index or table data traversed — roughly 0.5 RCU per 4 KB,
 * eventually consistent. Cheap is not free, though, and a count is answered on
 * a page load, so two ceilings bound it:
 *
 *   `cap`      — stop once the tally is large enough that nobody reads on. A
 *                list of 40,000 rows renders as "500+" pages, and no dispatcher
 *                pages to the end of that.
 *   `maxReads` — stop after so many round trips whatever the tally. This is the
 *                one that matters for a filtered Scan, where a sparse table can
 *                hand back page after page of almost nothing: after the Workiz
 *                import the users table held 6,787 rows of which 585 were
 *                users. The work a page load can cost stays bounded.
 *
 * Either ceiling makes the answer a floor, which `atLeast` reports and the
 * panel renders as `7+`. A walk that reaches the end of the list is exact, even
 * if it stops on the cap exactly.
 *
 * Pair it with a short-lived cache: the count changes slowly, the list under it
 * does not, and a dispatcher flipping filters should not re-count each time.
 */

export interface CountReadInput {
  ExclusiveStartKey?: Record<string, unknown>;
}

export interface CountReadOutput {
  Count?: number;
  LastEvaluatedKey?: Record<string, unknown>;
}

export interface CountRowsOptions {
  /** Stop once the tally reaches this. The answer is then "at least". */
  cap?: number;
  /** How many reads one count may spend. Past it the answer is "at least". */
  maxReads?: number;
}

export interface CountRowsResult {
  total: number;
  /** The walk stopped on a ceiling: there are `total` rows or more. */
  atLeast: boolean;
}

/**
 * The default read budget, matching `scanPage`: enough to walk a few megabytes
 * of index, little enough that no single request walks a whole table.
 */
const DEFAULT_MAX_READS = 20;

export async function countRows(
  read: (input: CountReadInput) => Promise<CountReadOutput>,
  options: CountRowsOptions = {},
): Promise<CountRowsResult> {
  const { cap, maxReads = DEFAULT_MAX_READS } = options;
  let total = 0;
  let key: Record<string, unknown> | undefined;
  let reads = 0;

  while (reads < maxReads) {
    const out = await read(key ? { ExclusiveStartKey: key } : {});
    reads += 1;
    total += out.Count ?? 0;
    key = out.LastEvaluatedKey;

    // The list ended. Exact, however the tally compares to the cap.
    if (!key) return { total, atLeast: false };
    if (cap !== undefined && total >= cap) return { total, atLeast: true };
  }

  // Out of reads with the list still going.
  return { total, atLeast: true };
}
