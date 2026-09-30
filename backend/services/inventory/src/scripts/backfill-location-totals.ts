/**
 * Give every warehouse and container row its stock totals.
 *
 * WHY
 * ---
 * The Warehouses and Containers lists show how much each location holds.
 * They used to fire the whole Stock popup request per row (88 containers →
 * 88 × `GET /stock/locations/container/:id`, a STOCK# Query to the end and a
 * BatchGet of every product per row) just to sum a number. `StockRepository`
 * now keeps `totalUnits` (Σ quantity of the location's STOCK# rows) and
 * `uniqueItems` (rows with quantity > 0) on the location's METADATA row, in
 * the same TransactWrite as every stock write — but only where the row
 * already carries them. Rows written before that (every imported location)
 * have none: the lists show "—" until this has run.
 *
 * HOW (per location, race-free against live stock writes)
 * ---
 *   1. Seed: `SET totalUnits = if_not_exists(totalUnits, 0), uniqueItems = …`
 *      — from here on every stock write moves them.
 *   2. Read the row (consistent), Query its STOCK# rows to the end
 *      (consistent), and SET the sums conditioned on the row still holding
 *      what was read. A stock write in between moved the totals in its own
 *      transaction, so the condition fails and the location is redone (a few
 *      times, then reported as busy for the next run).
 *
 * ORDER: run it in the same release that deploys the location totals, and
 * after EVERY Workiz import (imported locations carry no totals). It is also
 * the reconcile: whenever a list's number disagrees with the Stock popup for
 * any reason, a run recomputes it.
 *
 * Idempotent and upsert-only: a row whose totals are right is left alone,
 * nothing is removed; a location with no stock rows gets zeros.
 *
 * Usage:
 *   npm run backfill:location-totals -w backend/services/inventory
 */
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../../../../.env') });

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  LOCATION_TOTALS_SEED,
  sumLocationStock,
  totalsReconcileWrite,
} from '../stock/location-totals.backfill';

const INVENTORY_TABLE = process.env.INVENTORY_TABLE || 'BitCRM_Inventory';

/** Tries per location before it is reported as busy (stock moving under it). */
const ATTEMPTS = 5;

type Outcome = 'set' | 'unchanged' | 'busy' | 'gone';

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

  /** Every STOCK# row of one location, quantities only, read to the end. */
  async function stockOf(pk: string): Promise<Array<{ quantity?: unknown }>> {
    const rows: Array<{ quantity?: unknown }> = [];
    let key: Record<string, unknown> | undefined;
    do {
      const page = await client.send(
        new QueryCommand({
          TableName: INVENTORY_TABLE,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :stock)',
          ExpressionAttributeValues: { ':pk': pk, ':stock': 'STOCK#' },
          ProjectionExpression: '#quantity',
          ExpressionAttributeNames: { '#quantity': 'quantity' },
          ConsistentRead: true,
          ExclusiveStartKey: key,
        }),
      );
      rows.push(...((page.Items ?? []) as Array<{ quantity?: unknown }>));
      key = page.LastEvaluatedKey;
    } while (key);
    return rows;
  }

  let stockRows = 0;
  async function reconcile(pk: string): Promise<Outcome> {
    try {
      await client.send(
        new UpdateCommand({ TableName: INVENTORY_TABLE, Key: { PK: pk, SK: 'METADATA' }, ...LOCATION_TOTALS_SEED }),
      );
    } catch (err) {
      if (isConditionFailure(err)) return 'gone';
      throw err;
    }

    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      const { Item } = await client.send(
        new GetCommand({
          TableName: INVENTORY_TABLE,
          Key: { PK: pk, SK: 'METADATA' },
          ProjectionExpression: 'PK, totalUnits, uniqueItems',
          ConsistentRead: true,
        }),
      );
      if (!Item) return 'gone';
      const rows = await stockOf(pk);
      const write = totalsReconcileWrite(Item, sumLocationStock(rows));
      if (attempt === 1) stockRows += rows.length;
      if (!write) return 'unchanged';
      try {
        await client.send(
          new UpdateCommand({ TableName: INVENTORY_TABLE, Key: { PK: pk, SK: 'METADATA' }, ...write }),
        );
        console.log(
          `  ~ ${pk}: totalUnits ${String(Item.totalUnits)} → ${String(write.ExpressionAttributeValues[':units'])}, ` +
            `uniqueItems ${String(Item.uniqueItems)} → ${String(write.ExpressionAttributeValues[':items'])}`,
        );
        return 'set';
      } catch (err) {
        if (!isConditionFailure(err)) throw err;
        // Stock moved while it was counted; count again.
      }
    }
    return 'busy';
  }

  const counts: Record<Outcome, number> = { set: 0, unchanged: 0, busy: 0, gone: 0 };
  let scanned = 0;
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
        ProjectionExpression: 'PK',
        ExclusiveStartKey: lastKey,
      }),
    );
    for (const { PK } of (page.Items ?? []) as Array<{ PK: string }>) {
      scanned += 1;
      const outcome = await reconcile(PK);
      counts[outcome] += 1;
      if (outcome === 'busy') console.log(`  ! ${PK}: stock kept moving; run again`);
    }
    lastKey = page.LastEvaluatedKey;
  } while (lastKey);

  console.log(
    `\n${scanned} location(s) over ${stockRows} stock row(s): ${counts.set} set, ` +
      `${counts.unchanged} already right, ${counts.busy} busy (run again), ${counts.gone} deleted mid-run.`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Backfill failed:', err);
    process.exit(1);
  });
