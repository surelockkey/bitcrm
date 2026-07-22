/**
 * Seed the job-type catalog with the nine legacy hardcoded values, using
 * deterministic ids derived from the slug so the deal + technician migrations
 * can map to them without a lookup round-trip. Idempotent: existing ids are
 * left untouched. Prints the slug → id table at the end.
 *
 * Run this FIRST, before migrate-deal-job-types and migrate-technician-skills.
 *
 * Usage:
 *   ts-node src/scripts/seed-job-types.ts            # apply
 *   ts-node src/scripts/seed-job-types.ts --dry-run  # preview only
 */
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../../../../.env') });

import { createHash } from 'crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { type JobType } from '@bitcrm/types';
import {
  JOB_TYPE_PK_PREFIX,
  JOB_TYPE_SK,
  JOB_TYPE_GSI1PK,
} from '../job-types/job-types.constants';

const TABLE = process.env.DEALS_TABLE || 'BitCRM_Deals';
const DRY_RUN = process.argv.includes('--dry-run');

/** The legacy slugs and their display names. */
export const LEGACY_JOB_TYPES: Array<{ slug: string; name: string }> = [
  { slug: 'lockout', name: 'Lockout' },
  { slug: 'rekey', name: 'Rekey' },
  { slug: 'lock_change', name: 'Lock Change' },
  { slug: 'installation', name: 'Installation' },
  { slug: 'repair', name: 'Repair' },
  { slug: 'safe', name: 'Safe' },
  { slug: 'automotive', name: 'Automotive' },
  { slug: 'commercial', name: 'Commercial' },
  { slug: 'other', name: 'Other' },
];

/** Deterministic UUID-shaped id from a slug, so every migration agrees. */
export function jobTypeIdForSlug(slug: string): string {
  const h = createHash('sha1').update(`job-type:${slug}`).digest('hex');
  return [
    h.slice(0, 8),
    h.slice(8, 12),
    h.slice(12, 16),
    h.slice(16, 20),
    h.slice(20, 32),
  ].join('-');
}

export function docClient(): DynamoDBDocumentClient {
  return DynamoDBDocumentClient.from(
    new DynamoDBClient({
      region: process.env.AWS_REGION || 'us-east-1',
      ...(process.env.DYNAMODB_ENDPOINT && {
        endpoint: process.env.DYNAMODB_ENDPOINT,
        credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
      }),
    }),
    { marshallOptions: { removeUndefinedValues: true } },
  );
}

async function main(): Promise<void> {
  const client = docClient();
  const now = new Date().toISOString();
  let created = 0;

  for (let i = 0; i < LEGACY_JOB_TYPES.length; i++) {
    const { slug, name } = LEGACY_JOB_TYPES[i];
    const id = jobTypeIdForSlug(slug);
    // Higher-priority earlier in the list, so pickers keep the familiar order.
    const priority = LEGACY_JOB_TYPES.length - i;

    const existing = await client.send(
      new GetCommand({ TableName: TABLE, Key: { PK: `${JOB_TYPE_PK_PREFIX}${id}`, SK: JOB_TYPE_SK } }),
    );
    console.log(`${slug.padEnd(14)} → ${id}${existing.Item ? '  (exists)' : ''}`);
    if (existing.Item || DRY_RUN) continue;

    const jobType: JobType = {
      id, name, priority, active: true,
      createdBy: 'migration', createdAt: now, updatedAt: now,
    };
    await client.send(
      new PutCommand({
        TableName: TABLE,
        Item: {
          PK: `${JOB_TYPE_PK_PREFIX}${id}`,
          SK: JOB_TYPE_SK,
          GSI1PK: JOB_TYPE_GSI1PK,
          GSI1SK: `${String(priority).padStart(6, '0')}#${name.toLowerCase()}`,
          ...jobType,
        },
        ConditionExpression: 'attribute_not_exists(PK)',
      }),
    );
    created++;
  }

  console.log(`\nSeeded ${created} job type(s)${DRY_RUN ? ' (dry-run)' : ''}.`);
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('seed-job-types failed:', err);
      process.exit(1);
    });
}
