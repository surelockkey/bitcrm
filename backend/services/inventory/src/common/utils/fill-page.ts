import {
  scanPage,
  type ScanPageOptions,
  type ScanPageResult,
  type ScanReadInput,
  type ScanReadOutput,
} from '@bitcrm/shared';

/**
 * `scanPage`, with a page that is never longer than `limit`.
 *
 * `scanPage` reads 10 × limit rows at a time and cuts an overshooting page —
 * but only while the partition goes on. When the very read that overshot also
 * reached the end, it returns every row it has and no cursor: the containers
 * list (207 rows on one index partition, 88 of them real vans) answered
 * `limit=50` with all 88, and the table showed "1–88 of 88" under "Rows per
 * page 50" with Next disabled. Here the page is cut in that case too, and the
 * cursor points at the last row kept, so the next page starts with the first
 * row dropped.
 *
 * `keyOf` is required: it is what makes the cut safe.
 */
export async function fillPage<T>(
  read: (input: ScanReadInput) => Promise<ScanReadOutput<T>>,
  limit: number,
  options: ScanPageOptions<T> & { keyOf: (item: T) => Record<string, unknown> },
): Promise<ScanPageResult<T>> {
  const page = await scanPage(read, limit, options);
  if (page.items.length <= limit) return page;
  const kept = page.items.slice(0, limit);
  return { items: kept, lastKey: options.keyOf(kept[kept.length - 1]) };
}
