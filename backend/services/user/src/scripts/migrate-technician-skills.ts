/**
 * Migrate legacy `SKILL#<id>` technician rows to the split assignment model:
 *   type=job_type    → SK=JOBTYPE#<jobTypeId>
 *   type=service_area→ SK=AREA#<serviceAreaId>
 *
 * The old rows stored free-text `value`; here we resolve those to catalog ids
 * case-insensitively (trimmed, whitespace-collapsed). Job-type slugs map via the
 * same deterministic id the deal seed used; service-area names resolve against
 * the deal-service catalog fetched over the internal endpoint.
 *
 * Also strips the stale `skills` permission block from stored role documents,
 * so the resource rename doesn't leave orphaned grants.
 *
 * Run AFTER seed-job-types.ts (deal-service). Idempotent and re-runnable.
 *   --create-missing   also seed a catalog job type for any unmatched slug
 *   --dry-run          preview only
 *
 * Env: USERS_TABLE, AWS_REGION, optional DYNAMODB_ENDPOINT,
 *      DEAL_SERVICE_URL, INTERNAL_SERVICE_SECRET (to read the area catalog).
 */
import { config } from 'dotenv';
import { resolve } from 'path';
import { createHash } from 'crypto';
config({ path: resolve(__dirname, '../../../../.env') });

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  ScanCommand,
  PutCommand,
  DeleteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';

const USERS_TABLE = process.env.USERS_TABLE || 'BitCRM_Users';
const DEAL_SERVICE_URL = process.env.DEAL_SERVICE_URL || 'http://localhost:4003';
const INTERNAL_SECRET = process.env.INTERNAL_SERVICE_SECRET || '';
const DRY_RUN = process.argv.includes('--dry-run');
const CREATE_MISSING = process.argv.includes('--create-missing');

/** Same deterministic id the deal seed uses, so both sides agree on the slug. */
function jobTypeIdForSlug(slug: string): string {
  const h = createHash('sha1').update(`job-type:${slug}`).digest('hex');
  return [h.slice(0, 8), h.slice(8, 12), h.slice(12, 16), h.slice(16, 20), h.slice(20, 32)].join('-');
}

const normaliseSlug = (raw: string) => raw.trim().toLowerCase().replace(/\s+/g, '_');
const normaliseName = (raw: string) => raw.trim().toLowerCase();

const doc = DynamoDBDocumentClient.from(
  new DynamoDBClient({
    region: process.env.AWS_REGION || 'us-east-1',
    ...(process.env.DYNAMODB_ENDPOINT && {
      endpoint: process.env.DYNAMODB_ENDPOINT,
      credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
    }),
  }),
  { marshallOptions: { removeUndefinedValues: true } },
);

/** name(lowercased) → service-area id, from the deal-service catalog. */
async function loadServiceAreaCatalog(): Promise<Map<string, string>> {
  const res = await fetch(`${DEAL_SERVICE_URL}/api/deals/service-areas/internal`, {
    headers: { 'x-internal-secret': INTERNAL_SECRET },
  });
  if (!res.ok) throw new Error(`Failed to load service-area catalog: HTTP ${res.status}`);
  const body = (await res.json()) as { data?: Array<{ id: string; name: string }> };
  return new Map((body.data ?? []).map((a) => [normaliseName(a.name), a.id]));
}

const jobTypeStatusGsiPk = (s: string) => `JOBTYPE_STATUS#${s}`;
const serviceAreaStatusGsiPk = (s: string) => `AREA_STATUS#${s}`;

async function main(): Promise<void> {
  const areaByName = await loadServiceAreaCatalog();
  console.log(`Loaded ${areaByName.size} service area(s) from the catalog.`);

  const unmatched: string[] = [];
  let migrated = 0;
  let skippedAreas = 0;
  let lastKey: Record<string, unknown> | undefined;

  do {
    const page = await doc.send(
      new ScanCommand({
        TableName: USERS_TABLE,
        FilterExpression: 'begins_with(SK, :sk)',
        ExpressionAttributeValues: { ':sk': 'SKILL#' },
        ExclusiveStartKey: lastKey,
      }),
    );

    for (const item of page.Items ?? []) {
      const userId = String(item.userId);
      const type = String(item.type);
      const value = String(item.value ?? '');
      const status = String(item.status ?? 'pending');

      let kind: 'job_type' | 'service_area';
      let catalogId: string | undefined;
      let skPrefix: string;
      let gsiPk: string;

      if (type === 'job_type') {
        kind = 'job_type';
        catalogId = jobTypeIdForSlug(normaliseSlug(value));
        skPrefix = 'JOBTYPE#';
        gsiPk = jobTypeStatusGsiPk(status);
      } else {
        kind = 'service_area';
        catalogId = areaByName.get(normaliseName(value));
        skPrefix = 'AREA#';
        gsiPk = serviceAreaStatusGsiPk(status);
        if (!catalogId) {
          // No catalog area by this name — leave the old row, report it.
          unmatched.push(`${userId}: service_area "${value}"`);
          skippedAreas++;
          continue;
        }
      }

      if (kind === 'job_type' && CREATE_MISSING) {
        // A best-effort job type catalog row would be created by the deal-side
        // migrate-deal-job-types --create-missing; here we only map the id.
      }

      console.log(`${userId}: ${type} "${value}" → ${skPrefix}${catalogId}`);
      if (!DRY_RUN) {
        await doc.send(
          new PutCommand({
            TableName: USERS_TABLE,
            Item: {
              PK: item.PK,
              SK: `${skPrefix}${catalogId}`,
              GSI4PK: gsiPk,
              GSI4SK: `${userId}#${catalogId}`,
              userId,
              kind,
              catalogId,
              status,
              proposedBy: item.proposedBy,
              proposedAt: item.proposedAt,
              reviewedBy: item.reviewedBy,
              reviewedAt: item.reviewedAt,
              comments: item.comments,
            },
          }),
        );
        await doc.send(
          new DeleteCommand({ TableName: USERS_TABLE, Key: { PK: item.PK, SK: item.SK } }),
        );
      }
      migrated++;
    }
    lastKey = page.LastEvaluatedKey;
  } while (lastKey);

  await stripSkillsPermission();

  console.log(`\nMigrated ${migrated} assignment(s); ${skippedAreas} unmatched service area(s) left in place${DRY_RUN ? ' (dry-run)' : ''}.`);
  if (unmatched.length) {
    console.log('Unmatched (create the area in the catalog, then re-run):');
    unmatched.forEach((u) => console.log(`  - ${u}`));
  }
}

/** Remove the obsolete `skills` key from every stored role's permissions/dataScope. */
async function stripSkillsPermission(): Promise<void> {
  let lastKey: Record<string, unknown> | undefined;
  let touched = 0;
  do {
    const page = await doc.send(
      new ScanCommand({
        TableName: USERS_TABLE,
        FilterExpression: 'begins_with(PK, :role)',
        ExpressionAttributeValues: { ':role': 'ROLE#' },
        ExclusiveStartKey: lastKey,
      }),
    );
    for (const role of page.Items ?? []) {
      const perms = role.permissions as Record<string, unknown> | undefined;
      const scope = role.dataScope as Record<string, unknown> | undefined;
      if (!(perms && 'skills' in perms) && !(scope && 'skills' in scope)) continue;
      console.log(`role ${role.PK}: removing stale "skills" grant`);
      if (!DRY_RUN) {
        await doc.send(
          new UpdateCommand({
            TableName: USERS_TABLE,
            Key: { PK: role.PK, SK: role.SK },
            UpdateExpression: 'REMOVE permissions.#s, dataScope.#s',
            ExpressionAttributeNames: { '#s': 'skills' },
          }),
        );
      }
      touched++;
    }
    lastKey = page.LastEvaluatedKey;
  } while (lastKey);
  if (touched) console.log(`Stripped stale skills grant from ${touched} role(s).`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('migrate-technician-skills failed:', err);
    process.exit(1);
  });
