/**
 * Give every warehouse and container row its location index keys.
 *
 * WHY
 * ---
 * `GET /containers` and `GET /warehouses` were a filtered Scan over the shared
 * inventory table. With ~45k rows and ~90 locations the read budget ran out
 * before a page filled, so every page came back short and a different size.
 * The lists now Query GSI1 (`LOCATION#CONTAINER` / `LOCATION#WAREHOUSE`, sorted
 * by `<name lowercased>#<id>`), and a row without those keys is not in that
 * index at all — invisible to the list until this runs. The `search` filter
 * matches `searchName` (the lowercased name alone), written here as well.
 *
 * MUST run in the same release that deploys the index-backed lists, before
 * traffic: until it has, `GET /containers`, `GET /warehouses`, their counts
 * and the technician's van on a job line are all empty. Any edit of a row
 * from the UI heals that one row too, but nothing heals the rest.
 *
 * Idempotent and upsert-only: a row that already carries the expected keys is
 * left alone, a row with stale or missing keys gets them set, nothing is ever
 * removed. Each write requires the row to still look the way the scan saw it,
 * so a rename landing mid-run is skipped rather than overwritten — safe to
 * run again at any time.
 *
 * Usage:
 *   npm run backfill:location-index -w backend/services/inventory
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
  locationIndexKeysToWrite,
  locationIndexWriteCondition,
  type LocationIndexRow,
} from '../stock/location-index.backfill';

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

  let scanned = 0;
  let updated = 0;
  let skipped = 0;
  let lastKey: Record<string, unknown> | undefined;

  do {
    const page = await client.send(
      new ScanCommand({
        TableName: INVENTORY_TABLE,
        FilterExpression:
          'SK = :meta AND (begins_with(PK, :container) OR begins_with(PK, :warehouse))',
        ExpressionAttributeValues: {
          ':meta': 'METADATA',
          ':container': 'CONTAINER#',
          ':warehouse': 'WAREHOUSE#',
        },
        ProjectionExpression: 'PK, SK, id, #name, technicianName, GSI1PK, GSI1SK, searchName',
        ExpressionAttributeNames: { '#name': 'name' },
        ExclusiveStartKey: lastKey,
      }),
    );

    for (const item of (page.Items ?? []) as LocationIndexRow[]) {
      scanned += 1;
      const keys = locationIndexKeysToWrite(item);
      if (!keys) continue;

      // The write stands only if the row still looks the way the scan saw it:
      // never resurrect a row deleted since, never overwrite a rename that
      // landed since.
      const condition = locationIndexWriteCondition(item);
      try {
        await client.send(
          new UpdateCommand({
            TableName: INVENTORY_TABLE,
            Key: { PK: item.PK, SK: item.SK },
            UpdateExpression: 'SET GSI1PK = :pk, GSI1SK = :sk, searchName = :name',
            ExpressionAttributeValues: {
              ':pk': keys.GSI1PK,
              ':sk': keys.GSI1SK,
              ':name': keys.searchName,
              ...condition.ExpressionAttributeValues,
            },
            ConditionExpression: condition.ConditionExpression,
          }),
        );
        updated += 1;
        console.log(`  ~ ${item.PK}: GSI1SK = ${keys.GSI1SK}`);
      } catch (err) {
        if ((err as Error).name !== 'ConditionalCheckFailedException') throw err;
        skipped += 1;
        console.log(`  - ${item.PK}: changed since the scan, left alone`);
      }
    }
    lastKey = page.LastEvaluatedKey;
  } while (lastKey);

  console.log(
    `\n${scanned} location row(s) scanned, ${updated} updated, ${skipped} skipped (changed mid-run).`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Backfill failed:', err);
    process.exit(1);
  });
