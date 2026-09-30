/**
 * Stamp `dealId` onto the `DEALNUM#<code>` reservation rows.
 *
 * WHY
 * ---
 * A Job ID search used to be a scan with a `dealNumber` filter; after the
 * Workiz import that is 1.36 M rows for one code. `DealsService.list` now
 * looks the code up on its reservation row (`findIdByNumber`) and reads the
 * one deal — which needs the reservation to know its deal. New reservations
 * carry it from `reserveDealNumber(dealId)`; the Workiz importer writes it;
 * the rows written before this link do not have it, and this fills them.
 *
 * WHAT
 * ----
 * Walks the deal METADATA rows and, for every six-character `dealNumber`,
 * writes `dealId` onto `DEALNUM#<dealNumber>` when the row exists and does
 * not carry it yet. Idempotent and upsert-only; a reservation that already
 * names a different deal is reported and left alone.
 *
 * USAGE
 * -----
 *   npm run backfill:deal-number-links -w backend/services/deal            # dry run
 *   npm run backfill:deal-number-links -w backend/services/deal -- --apply
 */
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../../../../.env') });

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { isDealNumberCode } from '../deals/deal-number.util';

const TABLE = process.env.DEALS_TABLE || 'BitCRM_Deals';
const APPLY = process.argv.includes('--apply');

const client = DynamoDBDocumentClient.from(
  new DynamoDBClient({
    region: process.env.AWS_REGION || 'us-east-1',
    ...(process.env.DYNAMODB_ENDPOINT && {
      endpoint: process.env.DYNAMODB_ENDPOINT,
      credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
    }),
  }),
);

async function main(): Promise<void> {
  console.log(`Table: ${TABLE}`);
  console.log(`Mode:  ${APPLY ? 'APPLY' : 'DRY RUN'}\n`);

  let scanned = 0;
  let linked = 0;
  let skipped = 0;
  const conflicts: string[] = [];
  let lastKey: Record<string, unknown> | undefined;

  do {
    const page = await client.send(
      new ScanCommand({
        TableName: TABLE,
        FilterExpression: 'SK = :meta AND begins_with(PK, :deal)',
        ExpressionAttributeValues: { ':meta': 'METADATA', ':deal': 'DEAL#' },
        ProjectionExpression: 'id, dealNumber',
        ExclusiveStartKey: lastKey,
      }),
    );

    for (const item of page.Items ?? []) {
      scanned += 1;
      const code = String(item.dealNumber ?? '');
      // Old sequential numbers never had a reservation.
      if (!isDealNumberCode(code)) {
        skipped += 1;
        continue;
      }
      const dealId = item.id as string;
      try {
        if (!APPLY) {
          console.log(`would link DEALNUM#${code} -> ${dealId}`);
          linked += 1;
          continue;
        }
        await client.send(
          new UpdateCommand({
            TableName: TABLE,
            Key: { PK: `DEALNUM#${code.toUpperCase()}`, SK: 'UNIQUE' },
            UpdateExpression: 'SET dealId = :id',
            ExpressionAttributeValues: { ':id': dealId },
            // Only a reservation that exists and names nobody else.
            ConditionExpression: 'attribute_exists(PK) AND (attribute_not_exists(dealId) OR dealId = :id)',
          }),
        );
        linked += 1;
      } catch (error) {
        if ((error as Error).name === 'ConditionalCheckFailedException') {
          conflicts.push(`${code} (deal ${dealId})`);
          continue;
        }
        throw error;
      }
    }
    lastKey = page.LastEvaluatedKey;
  } while (lastKey);

  console.log(`\nScanned ${scanned} deals: ${linked} ${APPLY ? 'linked' : 'to link'}, ${skipped} without a code.`);
  if (conflicts.length) {
    console.log(`\n${conflicts.length} reservation(s) missing or naming another deal — left alone:`);
    for (const c of conflicts) console.log(`  ${c}`);
  }
}

main().catch((err) => {
  console.error('backfill-deal-number-links failed:', err);
  process.exit(1);
});
