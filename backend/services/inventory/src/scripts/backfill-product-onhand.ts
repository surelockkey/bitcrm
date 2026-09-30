/**
 * Give every product row its `onHand` — units across all locations.
 *
 * WHY
 * ---
 * `StockRepository` moves `onHand` on PRODUCT#<id> with every stock write, so
 * the product list and card can show a total without a BatchGet per row. The
 * products (and the 13 298 imported stock rows) written before the attribute
 * existed have none: this sums every STOCK# row per product and writes the
 * result, then sets 0 on the products no stock row mentions.
 *
 * ORDER: run it in the same release that deploys `onHand`, and after EVERY
 * Workiz import (imported rows carry no `onHand`). Until it has run, a stock
 * write leaves a product row without `onHand` alone — never a wrong number,
 * just no total on the list — and a product created by BitCRM starts at 0.
 *
 * It is also the reconcile: the stock row and `onHand` move in one
 * TransactWrite, so they cannot drift, but whenever a product's total
 * disagrees with `GET /stock/products/:id` for any reason, a run recomputes
 * it from the STOCK# rows.
 *
 * Idempotent and upsert-only: a re-run recomputes the same sums; nothing is
 * removed. Run it while stock is quiet — a move landing between the scan and
 * the write is folded in by the next run.
 *
 * Usage:
 *   npm run backfill:product-onhand -w backend/services/inventory
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
import { sumOnHand, type StockSumRow } from '../stock/product-onhand.backfill';

const INVENTORY_TABLE = process.env.INVENTORY_TABLE || 'BitCRM_Inventory';

async function scanAll<T>(
  client: DynamoDBDocumentClient,
  input: Omit<ConstructorParameters<typeof ScanCommand>[0], 'TableName' | 'ExclusiveStartKey'>,
): Promise<T[]> {
  const rows: T[] = [];
  let lastKey: Record<string, unknown> | undefined;
  do {
    const page = await client.send(
      new ScanCommand({ TableName: INVENTORY_TABLE, ...input, ExclusiveStartKey: lastKey }),
    );
    rows.push(...((page.Items ?? []) as T[]));
    lastKey = page.LastEvaluatedKey;
  } while (lastKey);
  return rows;
}

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

  const stockRows = await scanAll<StockSumRow>(client, {
    FilterExpression:
      'begins_with(SK, :stock) AND (begins_with(PK, :warehouse) OR begins_with(PK, :container))',
    ExpressionAttributeValues: {
      ':stock': 'STOCK#',
      ':warehouse': 'WAREHOUSE#',
      ':container': 'CONTAINER#',
    },
    ProjectionExpression: 'PK, SK, productId, quantity',
  });
  const totals = sumOnHand(stockRows);
  console.log(`${stockRows.length} stock row(s) over ${totals.size} product(s)`);

  let written = 0;
  let missing = 0;
  for (const [productId, onHand] of totals) {
    try {
      await client.send(
        new UpdateCommand({
          TableName: INVENTORY_TABLE,
          Key: { PK: `PRODUCT#${productId}`, SK: 'METADATA' },
          UpdateExpression: 'SET onHand = :n',
          ConditionExpression: 'attribute_exists(PK)',
          ExpressionAttributeValues: { ':n': onHand },
        }),
      );
      written += 1;
    } catch (err) {
      // Stock rows may name ids the catalog never persisted.
      if ((err as Error).name !== 'ConditionalCheckFailedException') throw err;
      missing += 1;
    }
  }

  // Second pass: products no stock row mentions hold nothing.
  const unset = await scanAll<{ PK: string }>(client, {
    FilterExpression:
      'begins_with(PK, :product) AND SK = :meta AND attribute_not_exists(onHand)',
    ExpressionAttributeValues: { ':product': 'PRODUCT#', ':meta': 'METADATA' },
    ProjectionExpression: 'PK',
  });
  let zeroed = 0;
  for (const { PK } of unset) {
    try {
      await client.send(
        new UpdateCommand({
          TableName: INVENTORY_TABLE,
          Key: { PK, SK: 'METADATA' },
          UpdateExpression: 'SET onHand = :zero',
          // A stock move since the scan already set it; leave that alone.
          ConditionExpression: 'attribute_exists(PK) AND attribute_not_exists(onHand)',
          ExpressionAttributeValues: { ':zero': 0 },
        }),
      );
      zeroed += 1;
    } catch (err) {
      if ((err as Error).name !== 'ConditionalCheckFailedException') throw err;
    }
  }

  console.log(
    `\n${written} product(s) given a total, ${missing} stock product(s) not in the catalog, ` +
      `${zeroed} set to 0.`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Backfill failed:', err);
    process.exit(1);
  });
