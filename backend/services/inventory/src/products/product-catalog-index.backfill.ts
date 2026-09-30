import { ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import {
  planCatalogIndexBackfill,
  type CatalogIndexRow,
  type CatalogIndexWrite,
} from './product-catalog-index';

/** Anything that sends a document-client command — the client itself, or a test double. */
export type BackfillSend = (command: ScanCommand | UpdateCommand) => Promise<any>;

export interface CatalogIndexBackfillResult {
  /** Product rows the scan returned. */
  scanned: number;
  /** Rows given their keys (or re-filed after a rename). */
  filed: number;
  /** Rows that already carried the right keys. */
  alreadyFiled: number;
  /** Rows an edit changed between the scan and the write — that edit filed them. */
  skipped: number;
}

export interface CatalogIndexBackfillOptions {
  /** Writes in flight at once within a page. */
  concurrency?: number;
  onSkip?: (pk: string) => void;
}

/**
 * The body of `backfill:product-catalog-index`: Scan the product rows (only the
 * attributes the decision needs), and send each page's planned writes a few at
 * a time. A write refused by its condition lost to an edit that filed the row
 * itself, so it is counted as skipped; any other failure stops the run, which
 * is safe to start again.
 */
export async function runCatalogIndexBackfill(
  send: BackfillSend,
  tableName: string,
  { concurrency = 25, onSkip }: CatalogIndexBackfillOptions = {},
): Promise<CatalogIndexBackfillResult> {
  const result: CatalogIndexBackfillResult = { scanned: 0, filed: 0, alreadyFiled: 0, skipped: 0 };

  const apply = async (write: CatalogIndexWrite): Promise<void> => {
    try {
      await send(new UpdateCommand({ TableName: tableName, ...write }));
      result.filed += 1;
    } catch (error: unknown) {
      if (!(error instanceof Error) || error.name !== 'ConditionalCheckFailedException') throw error;
      result.skipped += 1;
      onSkip?.(write.Key.PK);
    }
  };

  let lastKey: Record<string, unknown> | undefined;
  do {
    const page = await send(
      new ScanCommand({
        TableName: tableName,
        FilterExpression: 'begins_with(PK, :product) AND SK = :meta',
        ExpressionAttributeValues: { ':product': 'PRODUCT#', ':meta': 'METADATA' },
        ProjectionExpression: 'PK, SK, id, #name, GSI4PK, GSI4SK',
        ExpressionAttributeNames: { '#name': 'name' },
        ...(lastKey ? { ExclusiveStartKey: lastKey } : {}),
      }),
    );
    const rows = (page.Items ?? []) as CatalogIndexRow[];
    const plan = planCatalogIndexBackfill(rows);
    result.scanned += rows.length - plan.notProducts;
    result.alreadyFiled += plan.alreadyFiled;

    for (let i = 0; i < plan.writes.length; i += concurrency) {
      await Promise.all(plan.writes.slice(i, i + concurrency).map(apply));
    }
    lastKey = page.LastEvaluatedKey;
  } while (lastKey);

  return result;
}
