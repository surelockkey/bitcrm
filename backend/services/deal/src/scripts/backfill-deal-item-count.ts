/**
 * Backfill: stamp `itemCount` on every deal (the number of `PRODUCT#` line
 * rows). The deal service keeps it current on every line change from billing
 * onward; deals written before that have no count, so the
 * `GET /deals?needsInvoice=true` filter (`itemCount > 0`) would miss them.
 *
 * Idempotent and upsert-only: a deal is written only when its stored count is
 * absent or wrong. One full-table scan; counts are gathered in memory.
 *
 * Usage:
 *   ts-node src/scripts/backfill-deal-item-count.ts            # apply
 *   ts-node src/scripts/backfill-deal-item-count.ts --dry-run  # preview only
 */
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../../../../.env') });

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  ScanCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';

const TABLE = process.env.DEALS_TABLE || 'BitCRM_Deals';
const DRY_RUN = process.argv.includes('--dry-run');

const client = DynamoDBDocumentClient.from(
  new DynamoDBClient({
    region: process.env.AWS_REGION || 'us-east-1',
    ...(process.env.DYNAMODB_ENDPOINT && {
      endpoint: process.env.DYNAMODB_ENDPOINT,
      credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
    }),
  }),
  { marshallOptions: { removeUndefinedValues: true } },
);

async function main(): Promise<void> {
  const counts = new Map<string, number>();
  const stored = new Map<string, number | undefined>();
  let lastKey: Record<string, unknown> | undefined;

  do {
    const page = await client.send(
      new ScanCommand({
        TableName: TABLE,
        FilterExpression: 'begins_with(PK, :pk) AND (SK = :meta OR begins_with(SK, :sk))',
        ExpressionAttributeValues: { ':pk': 'DEAL#', ':meta': 'METADATA', ':sk': 'PRODUCT#' },
        ProjectionExpression: 'PK, SK, itemCount',
        ExclusiveStartKey: lastKey,
      }),
    );
    for (const item of page.Items ?? []) {
      const pk = item.PK as string;
      if (item.SK === 'METADATA') stored.set(pk, item.itemCount as number | undefined);
      else counts.set(pk, (counts.get(pk) ?? 0) + 1);
    }
    lastKey = page.LastEvaluatedKey;
  } while (lastKey);

  let updated = 0;
  for (const [pk, current] of stored) {
    const itemCount = counts.get(pk) ?? 0;
    if (current === itemCount) continue;
    console.log(`${pk}: itemCount ${current ?? '∅'} → ${itemCount}`);
    if (!DRY_RUN) {
      await client.send(
        new UpdateCommand({
          TableName: TABLE,
          Key: { PK: pk, SK: 'METADATA' },
          UpdateExpression: 'SET itemCount = :c',
          ExpressionAttributeValues: { ':c': itemCount },
          ConditionExpression: 'attribute_exists(PK)',
        }),
      );
    }
    updated++;
  }

  console.log(
    `\nChecked ${stored.size} deal(s); updated ${updated}${DRY_RUN ? ' (dry-run)' : ''}.`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('backfill-deal-item-count failed:', err);
    process.exit(1);
  });
