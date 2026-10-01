/**
 * File the jobs' timeline and attachment rows under their client (GSI10
 * ContactActivityIndex).
 *
 * WHY
 * ---
 * The client card's History and Files read one sparse index on the deals
 * table (`src/contacts/contact-index.ts`): CONTACT#<contactId> on the
 * timeline rows, CONTACTFILE#<contactId> on the attachment rows. The writers
 * stamp the keys on every row written since this shipped; every row written
 * before — native events and files up to the deploy, and any Workiz import
 * loaded without them — has none, and a row without them is not on the card.
 *
 * WHAT
 * ----
 * Parallel Scan of the deals table for `DEAL#…` / `TIMELINE#…` and `ATTACH#…`
 * rows that have no `GSI10PK` yet; for each, the job's `contactId` (one
 * GetItem per job, cached) and the same keys the writer puts
 * (`contactIndexBackfillUpdate`). Conditional
 * (`attribute_not_exists(GSI10PK)`): idempotent, upsert-only, never
 * overwrites a live write, never resurrects a deleted row. The import's own
 * `CLIENT#…` / `ACT#…` rows are not touched — the history reads them off
 * their partition.
 *
 * USAGE
 * -----
 *   npm run backfill:contact-index -w backend/services/deal                        # write
 *   npm run backfill:contact-index -w backend/services/deal -- --dry-run           # count what it would file
 *   … -- --segments 16 --concurrency 32                                            # a big table, faster
 *
 *   against dev:
 *   AWS_PROFILE=bitcrm-dev DYNAMODB_ENDPOINT= DEALS_TABLE=bitcrm-dev-deals \
 *     npm run backfill:contact-index -w backend/services/deal -- --dry-run
 *
 * Needs the index first: Terraform (`infra/dev/data_plane.tf`) or
 * `npm run setup:db` locally (adds it to an existing table).
 */
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../../../../.env') });

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import {
  CONTACT_BACKFILL_FILTER,
  CONTACT_BACKFILL_FILTER_VALUES,
  CONTACT_BACKFILL_PROJECTION,
  contactIndexBackfillUpdate,
  dealIdOfRow,
} from '../contacts/contact-index-backfill';

const TABLE = process.env.DEALS_TABLE || 'BitCRM_Deals';
const DRY_RUN = process.argv.includes('--dry-run');
const arg = (name: string, fallback: number) => {
  const i = process.argv.indexOf(`--${name}`);
  const n = i >= 0 ? Number(process.argv[i + 1]) : NaN;
  return Number.isInteger(n) && n > 0 ? n : fallback;
};
const SEGMENTS = arg('segments', 8);
const CONCURRENCY = arg('concurrency', 16);

// An empty DYNAMODB_ENDPOINT (set on the command line to override .env) means
// real AWS, with the profile / role the SDK's default chain finds.
const client = DynamoDBDocumentClient.from(
  new DynamoDBClient({
    region: process.env.AWS_REGION || 'us-east-1',
    maxAttempts: 10,
    ...(process.env.DYNAMODB_ENDPOINT && {
      endpoint: process.env.DYNAMODB_ENDPOINT,
      credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
    }),
  }),
  { marshallOptions: { removeUndefinedValues: true } },
);

const stats = { scanned: 0, timeline: 0, attachments: 0, noClient: 0, unkeyable: 0, raced: 0, deals: 0 };

/** The job's client, read once per job. `null` = the job is gone or has no client. */
const contactByDeal = new Map<string, Promise<string | null>>();
function contactIdOf(dealId: string): Promise<string | null> {
  let hit = contactByDeal.get(dealId);
  if (!hit) {
    stats.deals += 1;
    hit = client
      .send(
        new GetCommand({
          TableName: TABLE,
          Key: { PK: `DEAL#${dealId}`, SK: 'METADATA' },
          ProjectionExpression: 'contactId',
        }),
      )
      .then((res) => (typeof res.Item?.contactId === 'string' && res.Item.contactId ? res.Item.contactId : null));
    contactByDeal.set(dealId, hit);
  }
  return hit;
}

async function pool<T>(items: T[], n: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) await fn(items[next++]);
    }),
  );
}

async function file(row: Record<string, unknown>): Promise<void> {
  stats.scanned += 1;
  const dealId = dealIdOfRow(row);
  const contactId = dealId ? await contactIdOf(dealId) : null;
  if (!contactId) {
    stats.noClient += 1;
    return;
  }
  const update = contactIndexBackfillUpdate(row, contactId, TABLE);
  if (!update) {
    stats.unkeyable += 1;
    return;
  }
  if (!DRY_RUN) {
    try {
      await client.send(new UpdateCommand(update.input as never));
    } catch (err) {
      if ((err as Error).name === 'ConditionalCheckFailedException') {
        stats.raced += 1;
        return;
      }
      throw err;
    }
  }
  if (update.kind === 'timeline') stats.timeline += 1;
  else stats.attachments += 1;
}

async function segment(seg: number): Promise<void> {
  let lastKey: Record<string, unknown> | undefined;
  do {
    const page = await client.send(
      new ScanCommand({
        TableName: TABLE,
        Segment: seg,
        TotalSegments: SEGMENTS,
        FilterExpression: CONTACT_BACKFILL_FILTER,
        ExpressionAttributeValues: CONTACT_BACKFILL_FILTER_VALUES,
        ProjectionExpression: CONTACT_BACKFILL_PROJECTION.map((_, i) => `#p${i}`).join(', '),
        ExpressionAttributeNames: Object.fromEntries(CONTACT_BACKFILL_PROJECTION.map((a, i) => [`#p${i}`, a])),
        ExclusiveStartKey: lastKey,
      }),
    );
    await pool(page.Items ?? [], CONCURRENCY, file);
    lastKey = page.LastEvaluatedKey;
  } while (lastKey);
}

async function main(): Promise<void> {
  console.log(`Table: ${TABLE}${process.env.DYNAMODB_ENDPOINT ? ` (${process.env.DYNAMODB_ENDPOINT})` : ''}`);
  console.log(`Mode:  ${DRY_RUN ? 'DRY RUN' : 'APPLY'} — ${SEGMENTS} segments × ${CONCURRENCY} writes\n`);
  const started = Date.now();
  const verb = DRY_RUN ? 'to file' : 'filed';
  const progress = setInterval(
    () => console.log(`… ${stats.scanned} rows without the key seen, ${stats.timeline + stats.attachments} ${verb}`),
    30_000,
  );
  try {
    await Promise.all(Array.from({ length: SEGMENTS }, (_, i) => segment(i)));
  } finally {
    clearInterval(progress);
  }
  console.log(
    `\n${stats.scanned} rows without the key: ${stats.timeline} events + ${stats.attachments} files ${verb} ` +
      `across ${stats.deals} jobs; ${stats.noClient} on a job that is gone or has no client, ` +
      `${stats.unkeyable} without time/id, ${stats.raced} written meanwhile. ${Math.round((Date.now() - started) / 1000)}s.`,
  );
}

main().catch((err) => {
  console.error('backfill-contact-index failed:', err);
  process.exit(1);
});
