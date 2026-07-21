/**
 * Migration/backfill: recompute the derived `coverage` for every service-area
 * catalog row from its stored `definition`. Idempotent and safe to run
 * repeatedly, locally or on prod. Use it to heal rows written before geocoding
 * succeeded (e.g. GOOGLE_MAPS_API_KEY was missing) or after a geometry-model
 * change. This mirrors the self-healing ServiceAreasBackfill that runs on boot,
 * but as an explicit one-shot for the whole table (not just empty rows).
 *
 * Usage (local uses DYNAMODB_ENDPOINT from .env; prod uses real AWS creds):
 *   ts-node src/scripts/backfill-service-areas.ts            # apply
 *   ts-node src/scripts/backfill-service-areas.ts --dry-run  # preview only
 *
 * Env: DEALS_TABLE (default BitCRM_Deals), AWS_REGION, optional DYNAMODB_ENDPOINT,
 * GOOGLE_MAPS_API_KEY (required to geocode zip-type areas), REDIS_URL.
 */
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../../../../.env') });

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import Redis from 'ioredis';
import { GeocodingService } from '@bitcrm/shared';
import { type ServiceArea } from '@bitcrm/types';
import { deriveCoverage } from '../service-areas/service-areas.coverage';
import { SERVICE_AREA_GSI1PK } from '../service-areas/service-areas.constants';

const TABLE = process.env.DEALS_TABLE || 'BitCRM_Deals';
const DRY_RUN = process.argv.includes('--dry-run');

async function main(): Promise<void> {
  const client = DynamoDBDocumentClient.from(
    new DynamoDBClient({
      region: process.env.AWS_REGION || 'us-east-1',
      ...(process.env.DYNAMODB_ENDPOINT && {
        endpoint: process.env.DYNAMODB_ENDPOINT,
        credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
      }),
    }),
    { marshallOptions: { removeUndefinedValues: true } },
  );

  // GeocodingService only needs Redis for caching; a bare client is fine here.
  const redis = process.env.REDIS_URL ? new Redis(process.env.REDIS_URL) : undefined;
  const geocoding = new GeocodingService({ client: redis } as never);
  const geocodeZip = (zip: string) =>
    geocoding.geocode({ street: '', city: '', state: '', zip });

  const result = await client.send(
    new QueryCommand({
      TableName: TABLE,
      IndexName: 'StageIndex',
      KeyConditionExpression: 'GSI1PK = :pk',
      ExpressionAttributeValues: { ':pk': SERVICE_AREA_GSI1PK },
    }),
  );
  const areas = (result.Items || []) as ServiceArea[];
  console.log(`Found ${areas.length} service area(s)${DRY_RUN ? ' (dry-run)' : ''}`);

  let updated = 0;
  for (const area of areas) {
    try {
      const coverage = await deriveCoverage(area.definition, geocodeZip);
      const changed = JSON.stringify(coverage) !== JSON.stringify(area.coverage);
      if (!changed) continue;
      console.log(`  ${area.id} (${area.name}): ${area.coverage?.length ?? 0} → ${coverage.length} shape(s)`);
      if (!DRY_RUN) {
        await client.send(
          new PutCommand({
            TableName: TABLE,
            Item: {
              PK: `SERVICE_AREA#${area.id}`,
              SK: 'METADATA',
              GSI1PK: SERVICE_AREA_GSI1PK,
              GSI1SK: `${String(area.priority).padStart(6, '0')}#${area.name.toLowerCase()}`,
              ...area,
              coverage,
              updatedAt: new Date().toISOString(),
            },
          }),
        );
      }
      updated++;
    } catch (err) {
      console.warn(`  ${area.id} (${area.name}): skipped — ${(err as Error).message}`);
    }
  }

  console.log(`${DRY_RUN ? 'Would update' : 'Updated'} ${updated} area(s)`);
  if (redis) await redis.quit();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
