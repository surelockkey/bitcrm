import {
  scanPage,
  type ScanPageOptions,
  type ScanPageResult,
  type ScanReadInput,
  type ScanReadOutput,
} from '@bitcrm/shared';

export interface FillPageOptions<T> extends ScanPageOptions<T> {
  /**
   * Required: it is what lets a page that a read overfilled be cut, the
   * cursor on the last row kept, instead of handed back longer than `limit`
   * — `GET /containers?limit=50` once answered all 88 vans on one page.
   */
  keyOf: (item: T) => Record<string, unknown>;
  /**
   * The fewest rows one read asks for. `scanPage` asks for 10 × `limit`,
   * which is 100 rows at a page of ten: a rare search over a large partition
   * then runs out of reads long before the partition ends and answers a short
   * page with a cursor. At a thousand rows DynamoDB's 1 MB page stops a read
   * first (~1 KB rows), so every read is as large as a read can be.
   */
  readRows?: number;
}

/**
 * One filtered page: `scanPage`, never longer than `limit` (the cut itself
 * lives in `scanPage`), with `keyOf` required and an optional floor on the
 * rows each read asks for.
 */
export function fillPage<T>(
  read: (input: ScanReadInput) => Promise<ScanReadOutput<T>>,
  limit: number,
  { readRows, ...options }: FillPageOptions<T>,
): Promise<ScanPageResult<T>> {
  const reader = readRows
    ? (input: ScanReadInput) => read({ ...input, Limit: Math.max(input.Limit, readRows) })
    : read;
  return scanPage(reader, limit, options);
}
