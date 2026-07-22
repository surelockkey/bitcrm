/**
 * Migrate every deal's free-text `jobType` slug to a catalog `jobTypeId`, then
 * remove the old field. Idempotent: a deal already carrying `jobTypeId` is
 * skipped. Unrecognised slugs get their own catalog entry rather than being
 * dropped, so no data is lost.
 *
 * Run AFTER seed-job-types.ts.
 *
 * Usage:
 *   ts-node src/scripts/migrate-deal-job-types.ts            # apply
 *   ts-node src/scripts/migrate-deal-job-types.ts --dry-run  # preview only
 */
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../../../../.env') });

import { ScanCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { type JobType } from '@bitcrm/types';
import {
  JOB_TYPE_PK_PREFIX,
  JOB_TYPE_SK,
  JOB_TYPE_GSI1PK,
} from '../job-types/job-types.constants';
import { docClient, jobTypeIdForSlug } from './seed-job-types';

const TABLE = process.env.DEALS_TABLE || 'BitCRM_Deals';
const DRY_RUN = process.argv.includes('--dry-run');

const client = docClient();

/** Normalise a legacy slug so "Lock Change" / "lock_change" collapse together. */
const normalise = (raw: string) => raw.trim().toLowerCase().replace(/\s+/g, '_');

/** Ensure a catalog row exists for an unrecognised slug; returns its id. */
async function ensureCatalogEntry(slug: string, cache: Map<string, string>): Promise<string> {
  if (cache.has(slug)) return cache.get(slug)!;
  const id = jobTypeIdForSlug(slug);
  cache.set(slug, id);

  const name = slug
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');
  const now = new Date().toISOString();
  const jobType: JobType = {
    id, name, priority: 0, active: true,
    createdBy: 'migration', createdAt: now, updatedAt: now,
  };
  console.log(`  + catalog entry for unrecognised slug "${slug}" → ${id}`);
  if (!DRY_RUN) {
    await client.send(
      new PutCommand({
        TableName: TABLE,
        Item: {
          PK: `${JOB_TYPE_PK_PREFIX}${id}`,
          SK: JOB_TYPE_SK,
          GSI1PK: JOB_TYPE_GSI1PK,
          GSI1SK: `000000#${name.toLowerCase()}`,
          ...jobType,
        },
        ConditionExpression: 'attribute_not_exists(PK)',
      }),
    );
  }
  return id;
}

async function main(): Promise<void> {
  const cache = new Map<string, string>();
  let migrated = 0;
  let skipped = 0;
  let lastKey: Record<string, unknown> | undefined;

  do {
    // Deals live under PK=DEAL#<id>, SK=METADATA. Filter to those with a legacy
    // jobType and no jobTypeId yet.
    const page = await client.send(
      new ScanCommand({
        TableName: TABLE,
        FilterExpression: 'begins_with(PK, :deal) AND SK = :meta AND attribute_exists(jobType)',
        ExpressionAttributeValues: { ':deal': 'DEAL#', ':meta': 'METADATA' },
        ExclusiveStartKey: lastKey,
      }),
    );

    for (const item of page.Items ?? []) {
      if (item.jobTypeId) { skipped++; continue; }
      const slug = normalise(String(item.jobType));
      const known = jobTypeIdForSlug(slug);
      // Recognised slugs already have a seeded row; unknown ones get created.
      const jobTypeId =
        LEGACY_SLUGS.has(slug) ? known : await ensureCatalogEntry(slug, cache);

      console.log(`deal ${item.PK}: "${item.jobType}" → ${jobTypeId}`);
      if (!DRY_RUN) {
        await client.send(
          new UpdateCommand({
            TableName: TABLE,
            Key: { PK: item.PK, SK: item.SK },
            UpdateExpression: 'SET jobTypeId = :id REMOVE jobType',
            ExpressionAttributeValues: { ':id': jobTypeId },
          }),
        );
      }
      migrated++;
    }
    lastKey = page.LastEvaluatedKey;
  } while (lastKey);

  console.log(`\nMigrated ${migrated} deal(s), skipped ${skipped} already-migrated${DRY_RUN ? ' (dry-run)' : ''}.`);
}

const LEGACY_SLUGS = new Set([
  'lockout', 'rekey', 'lock_change', 'installation', 'repair', 'safe',
  'automotive', 'commercial', 'other',
]);

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('migrate-deal-job-types failed:', err);
    process.exit(1);
  });
