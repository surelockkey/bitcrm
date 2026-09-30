/**
 * File every product on the Price Book partition.
 *
 * WHY
 * ---
 * `GET /products` without a category and without `manageStock=true` — the
 * Price Book list — was a filtered Scan over the whole shared inventory table
 * (~46k rows). The Scan's read budget could not cover it, so a search answered
 * short or empty pages with a cursor. The list now Queries one partition on
 * GSI4 (TransferEntityIndex): `GSI4PK = PRODUCTS#ALL`,
 * `GSI4SK = <name lowercased, first 200 chars>#<id>`, on EVERY product row —
 * any type (product, service, Workiz other/hours), any status, any stock flag
 * (~16k rows on dev). A row without the keys is not in the Price Book at all
 * until this runs: before the first run on an environment the list and its
 * count are EMPTY. Every later create files the row, every edit re-files it.
 *
 * MUST run in the same release, before traffic, and after every Workiz import.
 *
 * Idempotent and upsert-only on the index keys: a row already filed correctly
 * is left alone, a row without the keys gets them, a row whose name changed
 * gets the corrected sort key. No other attribute is touched. Each write
 * requires the row to still hold the name and sort key the scan saw, so an
 * edit landing mid-run — which files the row itself — is skipped rather than
 * overwritten.
 *
 * Usage:
 *   npm run backfill:product-catalog-index -w backend/services/inventory
 */
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../../../../.env') });

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { runCatalogIndexBackfill } from '../products/product-catalog-index.backfill';

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

  const result = await runCatalogIndexBackfill((command) => client.send(command as never), INVENTORY_TABLE, {
    onSkip: (pk) => console.log(`  - ${pk}: changed since the scan, left alone`),
  });

  console.log(
    `\n${result.scanned} product row(s) scanned, ${result.filed} filed, ` +
      `${result.alreadyFiled} already filed, ${result.skipped} skipped (changed mid-run).`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Backfill failed:', err);
    process.exit(1);
  });
