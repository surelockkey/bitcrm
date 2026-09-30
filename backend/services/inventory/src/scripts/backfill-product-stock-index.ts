/**
 * File every stock-managed product on the "inventory products" partition.
 *
 * WHY
 * ---
 * `GET /products?manageStock=true` without a category was a filtered Scan over
 * the whole shared inventory table (~46k rows). The read budget of one request
 * covers ~10k of them, so a search such as "chain guard" answered an empty
 * first page with a cursor and the web said "No items match". The list now
 * Queries a sparse partition on GSI3 (OwnerIndex): `GSI3PK = PRODUCTS#STOCK`,
 * `GSI3SK = <name lowercased>#<id>`, on every product of type `product` whose
 * `manageStock` is not false (any status) — ~3.1k rows. A row without the keys
 * is not in that list at all until this runs; every later edit of a product
 * files it (and takes it off when it stops being stock-managed).
 *
 * MUST run in the same release, before traffic, and after every Workiz import.
 *
 * Idempotent and upsert-only on the index keys: a row already filed correctly
 * is left alone, a stock-managed row gets its keys (or a corrected sort key
 * after a rename), a row that is no longer stock-managed has them removed. No
 * other attribute is touched. Each write requires the row to still hold the
 * name, type, flag and sort key the scan saw, so an edit landing mid-run —
 * which files the row itself — is skipped rather than overwritten.
 *
 * Usage:
 *   npm run backfill:product-stock-index -w backend/services/inventory
 */
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../../../../.env') });

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  ScanCommand,
  UpdateCommand,
  type ScanCommandOutput,
} from '@aws-sdk/lib-dynamodb';
import { stockIndexWrite, type StockIndexRow } from '../products/product-stock-index';

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
  let filed = 0;
  let removed = 0;
  let skipped = 0;
  let lastKey: Record<string, unknown> | undefined;

  do {
    const page: ScanCommandOutput = await client.send(
      new ScanCommand({
        TableName: INVENTORY_TABLE,
        FilterExpression: 'begins_with(PK, :product) AND SK = :meta',
        ExpressionAttributeValues: { ':product': 'PRODUCT#', ':meta': 'METADATA' },
        ProjectionExpression: 'PK, SK, id, #name, #type, manageStock, GSI3PK, GSI3SK',
        ExpressionAttributeNames: { '#name': 'name', '#type': 'type' },
        ExclusiveStartKey: lastKey,
      }),
    );

    for (const row of (page.Items ?? []) as StockIndexRow[]) {
      scanned += 1;
      const write = stockIndexWrite(row);
      if (!write) continue;

      const { kind, ...input } = write;
      try {
        await client.send(new UpdateCommand({ TableName: INVENTORY_TABLE, ...input }));
        if (kind === 'set') filed += 1;
        else removed += 1;
      } catch (err) {
        if ((err as Error).name !== 'ConditionalCheckFailedException') throw err;
        skipped += 1;
        console.log(`  - ${row.PK}: changed since the scan, left alone`);
      }
    }
    lastKey = page.LastEvaluatedKey;
  } while (lastKey);

  console.log(
    `\n${scanned} product row(s) scanned, ${filed} filed, ${removed} taken off, ` +
      `${skipped} skipped (changed mid-run).`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Backfill failed:', err);
    process.exit(1);
  });
