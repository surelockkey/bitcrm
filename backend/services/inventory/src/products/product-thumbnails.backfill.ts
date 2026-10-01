import { QueryCommand, type UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { GSI4_NAME } from '../common/constants/dynamo.constants';
import { PRODUCT_CATALOG_INDEX_PK } from './product-catalog-index';
import {
  currentThumbKey,
  ensureThumbnail,
  type ThumbnailDeps,
  type ThumbnailOutcome,
  type ThumbnailRow,
} from './product-thumbnails';

/** Anything that sends the backfill's Query and UpdateCommands — the client itself, or a test double. */
export type ThumbnailBackfillSend = (command: QueryCommand | UpdateCommand) => Promise<any>;

export interface ThumbnailBackfillOptions {
  /** Thumbnails made at once. sharp is CPU-bound; a few keep S3 busy without starving the machine. */
  concurrency?: number;
  /** Count what would be made; read and write nothing else. */
  dryRun?: boolean;
  /** Remake thumbnails that are already current (after a size or format change). */
  force?: boolean;
  /** Stop after this many attempts — a trial run on a few items. */
  max?: number;
  /** Rows asked of one index read. */
  pageSize?: number;
  /** Each row handled: what came of it, or `pending` in a dry run. */
  onProgress?: (row: ThumbnailRow, outcome: ThumbnailOutcome | 'pending') => void;
  onWarn?: (message: string) => void;
}

export interface ThumbnailBackfillResult {
  /** Product rows with a photo the walk read. */
  withPhoto: number;
  /** Rows whose thumbnail was already the current photo's. */
  current: number;
  made: number;
  /** Would be made (dry run). */
  pending: number;
  /** The row names a photo S3 doesn't hold. */
  missing: number;
  /** The photo isn't a readable image. */
  unreadable: number;
  /** Photo replaced mid-run — the new photo's upload makes its own. */
  stale: number;
}

/**
 * The body of `backfill:product-thumbnails`: walk the Price Book partition
 * (GSI4 `PRODUCTS#ALL`, every product row — no Scan of the shared table),
 * keeping only rows with a photo, and make each missing thumbnail a few at a
 * time. Idempotent: a row whose `thumbKey` is its photo's is skipped (unless
 * `force`), and every write is conditioned on the photo it was made from.
 * Any failure other than a missing or unreadable photo stops the run, which is
 * safe to start again.
 */
export async function runProductThumbnailBackfill(
  deps: Omit<ThumbnailDeps, 'send'> & { send: ThumbnailBackfillSend },
  {
    concurrency = 4,
    dryRun = false,
    force = false,
    max = Infinity,
    pageSize = 500,
    onProgress,
    onWarn,
  }: ThumbnailBackfillOptions = {},
): Promise<ThumbnailBackfillResult> {
  const result: ThumbnailBackfillResult = {
    withPhoto: 0,
    current: 0,
    made: 0,
    pending: 0,
    missing: 0,
    unreadable: 0,
    stale: 0,
  };
  let attempts = 0;

  const handle = async (row: ThumbnailRow): Promise<void> => {
    const { outcome } = await ensureThumbnail({ ...deps, onWarn: onWarn ?? deps.onWarn }, row, { force });
    if (outcome === 'made' || outcome === 'missing' || outcome === 'unreadable' || outcome === 'stale') {
      result[outcome] += 1;
    } else if (outcome === 'current') {
      result.current += 1;
    }
    onProgress?.(row, outcome);
  };

  let lastKey: Record<string, unknown> | undefined;
  do {
    const page = await deps.send(
      new QueryCommand({
        TableName: deps.tableName,
        IndexName: GSI4_NAME,
        KeyConditionExpression: 'GSI4PK = :pk',
        FilterExpression: 'attribute_exists(photoKey)',
        ProjectionExpression: 'PK, GSI4PK, GSI4SK, id, photoKey, thumbKey',
        ExpressionAttributeValues: { ':pk': PRODUCT_CATALOG_INDEX_PK },
        Limit: pageSize,
        ...(lastKey ? { ExclusiveStartKey: lastKey } : {}),
      }),
    );
    const rows = ((page.Items ?? []) as Array<ThumbnailRow & { PK?: string }>)
      .map((r) => ({ ...r, id: r.id ?? String(r.PK ?? '').replace(/^PRODUCT#/, '') }))
      .filter((r) => typeof r.photoKey === 'string' && r.photoKey.length > 0);
    result.withPhoto += rows.length;

    const todo: ThumbnailRow[] = [];
    for (const row of rows) {
      if (!force && currentThumbKey(row)) {
        result.current += 1;
        continue;
      }
      if (attempts >= max) continue;
      attempts += 1;
      if (dryRun) {
        result.pending += 1;
        onProgress?.(row, 'pending');
        continue;
      }
      todo.push(row);
    }
    for (let i = 0; i < todo.length; i += concurrency) {
      await Promise.all(todo.slice(i, i + concurrency).map(handle));
    }
    lastKey = page.LastEvaluatedKey;
  } while (lastKey && attempts < max);

  return result;
}
