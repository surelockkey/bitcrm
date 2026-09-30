/**
 * File every transfer row on the month index, and set the walk's floor.
 *
 * WHY
 * ---
 * `GET /transfers` and its count were a filtered Scan of the shared inventory
 * table (~46k rows, a handful of them transfers): Scan+Limit filters AFTER the
 * limit, so a page came back empty with a cursor while transfers existed, in
 * hash order, and every count read up to 20 MB. The list now walks GSI1
 * `TRANSFERS#<YYYY-MM>` / `<createdAt>#<id>` newest first, from the current
 * month down to `firstMonth` on `TRANSFERS#INDEX / METADATA`. A transfer row
 * without those keys — every one written before this release — is not in the
 * list at all until this has run.
 *
 * ORDER: run it in the same release that deploys the month index, right
 * after the deploy, and after any import that writes transfer rows. New
 * transfers are filed by the repository as they are written.
 *
 * Idempotent and upsert-only: a row that carries the right keys is left
 * alone, nothing is removed, `firstMonth` only ever moves down. Each key write
 * requires the row to still exist with the `createdAt` it was filed by.
 *
 * Usage:
 *   npm run backfill:transfer-index -w backend/services/inventory
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
import {
  earliestMonth,
  transferIndexKeysToWrite,
  type TransferIndexRow,
} from '../transfers/transfer-index.backfill';
import { TRANSFERS_FLOOR_KEY } from '../transfers/transfers.constants';

const INVENTORY_TABLE = process.env.INVENTORY_TABLE || 'BitCRM_Inventory';

async function main() {
  const client = DynamoDBDocumentClient.from(
    new DynamoDBClient({
      region: process.env.AWS_REGION || 'us-east-1',
      ...(process.env.DYNAMODB_ENDPOINT && {
        endpoint: process.env.DYNAMODB_ENDPOINT,
        credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
      }),
    }),
  );
  console.log(`Table: ${INVENTORY_TABLE}`);

  const isConditionFailure = (err: unknown) =>
    (err as Error).name === 'ConditionalCheckFailedException';

  let scanned = 0;
  let filed = 0;
  let skipped = 0;
  const createdAts: string[] = [];
  let lastKey: Record<string, unknown> | undefined;

  do {
    const page = await client.send(
      new ScanCommand({
        TableName: INVENTORY_TABLE,
        FilterExpression: 'begins_with(PK, :transfer) AND SK = :meta',
        ExpressionAttributeValues: { ':transfer': 'TRANSFER#', ':meta': 'METADATA' },
        ProjectionExpression: 'PK, SK, id, createdAt, GSI1PK, GSI1SK',
        ExclusiveStartKey: lastKey,
      }),
    );

    for (const row of (page.Items ?? []) as TransferIndexRow[]) {
      scanned += 1;
      const keys = transferIndexKeysToWrite(row);
      if (typeof row.createdAt === 'string') createdAts.push(row.createdAt);
      if (!keys) continue;
      try {
        await client.send(
          new UpdateCommand({
            TableName: INVENTORY_TABLE,
            Key: { PK: row.PK, SK: row.SK },
            UpdateExpression: 'SET GSI1PK = :pk, GSI1SK = :sk',
            ConditionExpression: 'attribute_exists(PK) AND createdAt = :createdAt',
            ExpressionAttributeValues: { ':pk': keys.GSI1PK, ':sk': keys.GSI1SK, ':createdAt': row.createdAt },
          }),
        );
        filed += 1;
      } catch (err) {
        if (!isConditionFailure(err)) throw err;
        skipped += 1;
        console.log(`  - ${row.PK}: changed or deleted since the scan, left alone`);
      }
    }
    lastKey = page.LastEvaluatedKey;
  } while (lastKey);

  const floor = earliestMonth(createdAts);
  let floorMoved = false;
  if (floor) {
    try {
      await client.send(
        new UpdateCommand({
          TableName: INVENTORY_TABLE,
          Key: { ...TRANSFERS_FLOOR_KEY },
          UpdateExpression: 'SET firstMonth = :month',
          ConditionExpression: 'attribute_not_exists(firstMonth) OR firstMonth > :month',
          ExpressionAttributeValues: { ':month': floor },
        }),
      );
      floorMoved = true;
    } catch (err) {
      if (!isConditionFailure(err)) throw err;
    }
  }

  console.log(
    `\n${scanned} transfer row(s) scanned, ${filed} filed on the month index, ${skipped} skipped (changed mid-run). ` +
      (floor
        ? `First month ${floor} (${floorMoved ? 'set' : 'already at or below it'}).`
        : 'No transfers: first month left unset.'),
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Backfill failed:', err);
    process.exit(1);
  });
