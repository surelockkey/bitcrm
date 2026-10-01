/**
 * Make the list thumbnail of every product photo already stored.
 *
 * WHY
 * ---
 * The Items and Price Book tables show each item's photo as a 40×40 picture,
 * as Workiz does. A row carries `thumbnailUrl` — a presigned GET of a 128×128
 * webp beside the photo (`products/<id>/thumb-<uuid>.webp`, named in the
 * row's `thumbKey`) — never the full photo. New uploads get theirs from
 * `POST /products/:id/photo/complete`; the photos stored before it (the
 * Workiz import, ~1 200 on dev) get theirs here.
 *
 * Run once after inventory-service with the thumbnail step is deployed, and
 * after every import that brings photos. Until it has run, those items show
 * the placeholder and open their photo from it.
 *
 * Walks the Price Book partition on GSI4 (every product row; no Scan of the
 * shared table), so `backfill:product-catalog-index` must have filed the rows
 * first. Idempotent: a row whose `thumbKey` is its photo's is skipped, each
 * write is conditioned on the photo it was made from, and a run stopped
 * half-way is simply started again. It touches `thumbKey` and the thumbnail
 * files only — never the photo, `updatedAt` or any index key.
 *
 * Usage:
 *   npm run backfill:product-thumbnails -w backend/services/inventory
 *   npm run backfill:product-thumbnails -w backend/services/inventory -- --dry-run
 *   npm run backfill:product-thumbnails -w backend/services/inventory -- --max 20
 *   npm run backfill:product-thumbnails -w backend/services/inventory -- --force
 *   (--concurrency N: thumbnails at once, default 4)
 *
 * Needs the service's env: INVENTORY_TABLE, S3_BUCKET (or DOCUMENTS_BUCKET),
 * AWS_REGION and credentials that may read and write the bucket.
 */
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../../../../.env') });

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { S3Service } from '@bitcrm/shared';
import { runProductThumbnailBackfill } from '../products/product-thumbnails.backfill';

const INVENTORY_TABLE = process.env.INVENTORY_TABLE || 'BitCRM_Inventory';

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function number(name: string): number | undefined {
  const at = process.argv.indexOf(`--${name}`);
  if (at < 0) return undefined;
  const n = Number(process.argv[at + 1]);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`--${name} takes a positive whole number`);
  return n;
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
  const s3 = new S3Service();
  const dryRun = flag('dry-run');
  console.log(
    `Table: ${INVENTORY_TABLE}; bucket: ${process.env.DOCUMENTS_BUCKET || process.env.S3_BUCKET || 'bitcrm-uploads'}` +
      (dryRun ? ' (dry run)' : ''),
  );

  let done = 0;
  const result = await runProductThumbnailBackfill(
    { s3, send: (command) => client.send(command as never), tableName: INVENTORY_TABLE },
    {
      dryRun,
      force: flag('force'),
      max: number('max'),
      concurrency: number('concurrency'),
      onWarn: (message) => console.warn(`  ! ${message}`),
      onProgress: (row, outcome) => {
        done += 1;
        if (outcome !== 'made' && outcome !== 'pending') console.log(`  - ${row.id}: ${outcome}`);
        if (done % 50 === 0) console.log(`  … ${done} handled`);
      },
    },
  );

  console.log(
    `\n${result.withPhoto} product(s) with a photo: ${result.made} thumbnail(s) made, ` +
      `${result.current} already current` +
      (dryRun ? `, ${result.pending} to make` : '') +
      `, ${result.missing} photo(s) missing from S3, ${result.unreadable} unreadable, ` +
      `${result.stale} replaced mid-run.`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Backfill failed:', err);
    process.exit(1);
  });
