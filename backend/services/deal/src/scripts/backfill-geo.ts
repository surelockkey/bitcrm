import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../../../../.env') });

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  ScanCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import Redis from 'ioredis';
import { GeocodingService, type GeocodableAddress } from '@bitcrm/shared';

/**
 * One-off backfill: deals created before geocoding existed carry an address but
 * no coordinates, so they cannot appear on the dispatch map or be distance-ranked.
 * This walks them, geocodes, and writes lat/lng back.
 *
 * Idempotent — a deal that already has coordinates is skipped, so it is safe to
 * re-run after a partial pass. Dry-run by default: geocoding costs money, so the
 * write only happens with --apply.
 *
 *   npx ts-node src/scripts/backfill-geo.ts            # report only
 *   npx ts-node src/scripts/backfill-geo.ts --apply    # geocode + persist
 */

const TABLE_NAME = process.env.DEALS_TABLE || 'BitCRM_Deals';
const APPLY = process.argv.includes('--apply');

interface DealItem {
  PK: string;
  SK: string;
  id: string;
  dealNumber?: number;
  address?: GeocodableAddress & { lat?: number; lng?: number };
}

function buildClient(): DynamoDBDocumentClient {
  const client = new DynamoDBClient({
    region: process.env.AWS_REGION || 'us-east-1',
    ...(process.env.DYNAMODB_ENDPOINT && {
      endpoint: process.env.DYNAMODB_ENDPOINT,
      credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
    }),
  });
  return DynamoDBDocumentClient.from(client);
}

/** Every deal row, drained across scan pages. */
async function scanDeals(db: DynamoDBDocumentClient): Promise<DealItem[]> {
  const deals: DealItem[] = [];
  let startKey: Record<string, unknown> | undefined;

  do {
    const page = await db.send(
      new ScanCommand({
        TableName: TABLE_NAME,
        FilterExpression: 'begins_with(PK, :pk) AND SK = :sk',
        ExpressionAttributeValues: { ':pk': 'DEAL#', ':sk': 'METADATA' },
        ExclusiveStartKey: startKey,
      }),
    );
    deals.push(...((page.Items ?? []) as DealItem[]));
    startKey = page.LastEvaluatedKey;
  } while (startKey);

  return deals;
}

async function main(): Promise<void> {
  if (!process.env.GOOGLE_MAPS_API_KEY) {
    console.error('GOOGLE_MAPS_API_KEY is not set — nothing to do.');
    process.exit(1);
  }

  const db = buildClient();
  const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
    maxRetriesPerRequest: 3,
  });
  const geocoding = new GeocodingService({ client: redis } as never);

  console.log(
    `Scanning ${TABLE_NAME}${APPLY ? '' : ' (dry run — pass --apply to write)'}…`,
  );
  const deals = await scanDeals(db);

  const missing = deals.filter(
    (d) => d.address && (d.address.lat === undefined || d.address.lng === undefined),
  );

  console.log(
    `${deals.length} deals, ${deals.length - missing.length} already located, ${missing.length} to geocode.`,
  );

  let located = 0;
  let failed = 0;

  for (const deal of missing) {
    const coords = await geocoding.geocode(deal.address!);

    if (!coords) {
      failed++;
      console.warn(
        `  unresolved  #${deal.dealNumber ?? deal.id}  ${deal.address!.street}, ${deal.address!.city}`,
      );
      continue;
    }

    if (APPLY) {
      try {
        await db.send(
          new UpdateCommand({
            TableName: TABLE_NAME,
            Key: { PK: deal.PK, SK: deal.SK },
            // Alias every path segment — the repository does the same, and a bare
            // `address.lat` would break the day one of these becomes a reserved word.
            UpdateExpression: 'SET #address.#lat = :lat, #address.#lng = :lng',
            ExpressionAttributeNames: {
              '#address': 'address',
              '#lat': 'lat',
              '#lng': 'lng',
            },
            ExpressionAttributeValues: { ':lat': coords.lat, ':lng': coords.lng },
            ConditionExpression: 'attribute_exists(PK)',
          }),
        );
      } catch (error) {
        // One unwritable row must not abandon the rest of the backfill.
        failed++;
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`  write failed #${deal.dealNumber ?? deal.id}: ${message}`);
        continue;
      }
    }

    located++;
    console.log(
      `  ${APPLY ? 'located   ' : 'would set '} #${deal.dealNumber ?? deal.id}  ${coords.lat}, ${coords.lng}`,
    );
  }

  console.log(
    `\nDone. ${located} ${APPLY ? 'geocoded' : 'resolvable'}, ${failed} unresolved.`,
  );
  if (failed > 0) {
    console.log(
      'Unresolved deals stay off the dispatch map until their address is corrected.',
    );
  }
  if (!APPLY && located > 0) {
    console.log('Nothing was written. Re-run with --apply to persist.');
  }

  await redis.quit();
}

main().catch((error) => {
  console.error('Backfill failed:', error);
  process.exit(1);
});
