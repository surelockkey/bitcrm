/**
 * Backfill: stamp `totals` (the money snapshot the dashboards and reports sum)
 * and `itemCount` on every deal, from its `PRODUCT#` lines, tax and discount.
 * The deal service keeps both current on every line, tax or discount change
 * from here on; deals written before that — the Workiz import included — have
 * no snapshot.
 *
 * Idempotent and upsert-only: a deal is written only when what it stores is
 * absent or wrong. One full-table scan; lines are gathered in memory.
 *
 * Usage:
 *   ts-node src/scripts/backfill-deal-totals.ts            # apply
 *   ts-node src/scripts/backfill-deal-totals.ts --dry-run  # preview only
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
import { type Deal, type DealProduct } from '@bitcrm/types';
import { dealTotalsSnapshot, totalsBackfillUpdate } from '../deals/billing/deal-totals';

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

type Meta = Pick<Deal, 'taxRatePercent' | 'discount' | 'itemCount' | 'totals'>;

async function main(): Promise<void> {
  const metas = new Map<string, Meta>();
  const lines = new Map<string, DealProduct[]>();
  let lastKey: Record<string, unknown> | undefined;

  do {
    const page = await client.send(
      new ScanCommand({
        TableName: TABLE,
        FilterExpression: 'begins_with(PK, :pk) AND (SK = :meta OR begins_with(SK, :sk))',
        ExpressionAttributeValues: { ':pk': 'DEAL#', ':meta': 'METADATA', ':sk': 'PRODUCT#' },
        ProjectionExpression: 'PK, SK, taxRatePercent, discount, itemCount, totals, quantity, priceClient, costCompany, taxable',
        ExclusiveStartKey: lastKey,
      }),
    );
    for (const item of page.Items ?? []) {
      const pk = item.PK as string;
      if (item.SK === 'METADATA') metas.set(pk, item as Meta);
      else lines.set(pk, [...(lines.get(pk) ?? []), item as DealProduct]);
    }
    lastKey = page.LastEvaluatedKey;
  } while (lastKey);

  let updated = 0;
  for (const [pk, meta] of metas) {
    const own = lines.get(pk) ?? [];
    const update = totalsBackfillUpdate(meta, own.length, dealTotalsSnapshot(meta, own));
    if (!update) continue;
    console.log(`${pk}: total ${meta.totals?.total ?? '∅'} → ${update.totals.total}, items ${meta.itemCount ?? '∅'} → ${update.itemCount}`);
    if (!DRY_RUN) {
      await client.send(
        new UpdateCommand({
          TableName: TABLE,
          Key: { PK: pk, SK: 'METADATA' },
          UpdateExpression: 'SET itemCount = :c, totals = :t',
          ExpressionAttributeValues: { ':c': update.itemCount, ':t': update.totals },
          ConditionExpression: 'attribute_exists(PK)',
        }),
      );
    }
    updated++;
  }

  console.log(
    `\nChecked ${metas.size} deal(s); updated ${updated}${DRY_RUN ? ' (dry-run)' : ''}.`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('backfill-deal-totals failed:', err);
    process.exit(1);
  });
