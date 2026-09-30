/**
 * Give every product row its search attributes.
 *
 * WHY
 * ---
 * `GET /products?search=` used to run `contains` against the stored `name`
 * and `sku` with the term as typed — a byte comparison, so `lock` missed
 * "Lock Set" and `Lock` missed "padlock", while the warehouses, containers
 * and the inventory log lowercased both sides. The list now matches
 * `searchName` / `searchSku` (name and SKU lowercased, written by
 * ProductsRepository on create and rename), and a row without them is simply
 * never found: this writes them on every product that lacks them or holds a
 * stale one.
 *
 * MUST run in the same release that deploys the new filter, before traffic,
 * and after EVERY Workiz import that does not write the attributes itself.
 *
 * Idempotent and upsert-only: a row that already carries the right values is
 * left alone, nothing is ever removed. Each write requires the name and SKU
 * the scan saw, so a rename landing mid-run is skipped rather than reverted —
 * safe to run again at any time.
 *
 * Usage:
 *   npm run backfill:product-search -w backend/services/inventory
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
  productSearchKeysToWrite,
  type ProductSearchRow,
} from '../products/product-search.backfill';

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
        FilterExpression: 'begins_with(PK, :product) AND SK = :meta',
        ExpressionAttributeValues: { ':product': 'PRODUCT#', ':meta': 'METADATA' },
        ProjectionExpression: 'PK, SK, #name, sku, searchName, searchSku',
        ExpressionAttributeNames: { '#name': 'name' },
        ExclusiveStartKey: lastKey,
      }),
    );

    for (const item of (page.Items ?? []) as ProductSearchRow[]) {
      scanned += 1;
      const keys = productSearchKeysToWrite(item);
      if (!keys) continue;

      // The write stands only if the row still reads the way the scan saw it:
      // never resurrect a deleted row, never revert a rename that landed since.
      const seen: string[] = ['attribute_exists(PK)'];
      const values: Record<string, unknown> = { ':name': keys.searchName, ':sku': keys.searchSku };
      if (typeof item.name === 'string') {
        seen.push('#name = :seenName');
        values[':seenName'] = item.name;
      } else {
        seen.push('attribute_not_exists(#name)');
      }
      try {
        await client.send(
          new UpdateCommand({
            TableName: INVENTORY_TABLE,
            Key: { PK: item.PK, SK: item.SK },
            UpdateExpression: 'SET searchName = :name, searchSku = :sku',
            ExpressionAttributeNames: { '#name': 'name' },
            ExpressionAttributeValues: values,
            ConditionExpression: seen.join(' AND '),
          }),
        );
        updated += 1;
      } catch (err) {
        if ((err as Error).name !== 'ConditionalCheckFailedException') throw err;
        skipped += 1;
        console.log(`  - ${item.PK}: changed since the scan, left alone`);
      }
    }
    lastKey = page.LastEvaluatedKey;
  } while (lastKey);

  console.log(
    `\n${scanned} product row(s) scanned, ${updated} updated, ${skipped} skipped (changed mid-run).`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Backfill failed:', err);
    process.exit(1);
  });
