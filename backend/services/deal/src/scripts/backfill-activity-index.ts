/**
 * File the timeline rows in the Activity report's indexes.
 *
 * WHY
 * ---
 * Reports → Activity reads a period off two sparse indexes on the timeline
 * rows (GSI8 ActivityDayIndex by New York day, GSI9 ActorIndex by who did it —
 * `src/activity/activity.constants.ts`). The timeline writer stamps their keys
 * on every event written since this shipped; every row written before — all
 * of the Workiz import (~9.15 M events), and native events up to the deploy —
 * has none, and a row without them is not in the report.
 *
 * WHAT
 * ----
 * Parallel Scan of the deals table for `TIMELINE#` / `ACT#` rows that have no
 * `GSI8PK` yet; for each Activity event (every native event, and of the
 * imported rows only Workiz's own activity log — `isActivityItem`) it sets
 * GSI8PK/SK, GSI9PK/SK and `activitySearch` with the same function the writer
 * uses. Conditional (`attribute_not_exists(GSI8PK)`): idempotent, upsert-only,
 * never overwrites a live write, never resurrects a deleted row. It does NOT
 * move the day counters — run `recount:activity` after it (the counters are
 * then exact whatever ran before).
 *
 * USAGE
 * -----
 *   npm run backfill:activity-index -w backend/services/deal                  # dry run: what it would file
 *   npm run backfill:activity-index -w backend/services/deal -- --apply
 *   … -- --apply --segments 16 --concurrency 32                               # a big table, faster
 *
 * Needs the indexes first: Terraform (`infra/dev/data_plane.tf`) or
 * `npm run setup:activity-indexes` locally.
 */
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../../../../.env') });

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { AccountClock } from '@bitcrm/types';
import {
  ACTIVITY_BACKFILL_FILTER,
  ACTIVITY_BACKFILL_FILTER_VALUES,
  ACTIVITY_BACKFILL_PROJECTION,
  activityBackfillUpdate,
} from '../activity/activity-backfill';

const TABLE = process.env.DEALS_TABLE || 'BitCRM_Deals';
const APPLY = process.argv.includes('--apply');
const arg = (name: string, fallback: number) => {
  const i = process.argv.indexOf(`--${name}`);
  const n = i >= 0 ? Number(process.argv[i + 1]) : NaN;
  return Number.isInteger(n) && n > 0 ? n : fallback;
};
const SEGMENTS = arg('segments', 8);
const CONCURRENCY = arg('concurrency', 16);

const client = DynamoDBDocumentClient.from(
  new DynamoDBClient({
    region: process.env.AWS_REGION || 'us-east-1',
    maxAttempts: 10,
    ...(process.env.DYNAMODB_ENDPOINT && {
      endpoint: process.env.DYNAMODB_ENDPOINT,
      credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
    }),
  }),
);

const clock = new AccountClock();
const stats = { scanned: 0, filed: 0, notActivity: 0, raced: 0, days: new Set<string>() };

async function pool<T>(items: T[], n: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) await fn(items[next++]);
    }),
  );
}

async function segment(seg: number): Promise<void> {
  let lastKey: Record<string, unknown> | undefined;
  do {
    const page = await client.send(
      new ScanCommand({
        TableName: TABLE,
        Segment: seg,
        TotalSegments: SEGMENTS,
        FilterExpression: ACTIVITY_BACKFILL_FILTER,
        ExpressionAttributeValues: ACTIVITY_BACKFILL_FILTER_VALUES,
        ProjectionExpression: ACTIVITY_BACKFILL_PROJECTION.map((_, i) => `#p${i}`).join(', '),
        ExpressionAttributeNames: Object.fromEntries(ACTIVITY_BACKFILL_PROJECTION.map((a, i) => [`#p${i}`, a])),
        ExclusiveStartKey: lastKey,
      }),
    );
    await pool(page.Items ?? [], CONCURRENCY, async (item) => {
      stats.scanned += 1;
      const update = activityBackfillUpdate(item, clock, TABLE);
      if (!update) {
        stats.notActivity += 1;
        return;
      }
      stats.days.add(update.day);
      if (!APPLY) {
        stats.filed += 1;
        return;
      }
      try {
        await client.send(new UpdateCommand(update.input as never));
        stats.filed += 1;
      } catch (err) {
        if ((err as Error).name === 'ConditionalCheckFailedException') stats.raced += 1;
        else throw err;
      }
    });
    lastKey = page.LastEvaluatedKey;
  } while (lastKey);
}

async function main(): Promise<void> {
  console.log(`Table: ${TABLE}`);
  console.log(`Mode:  ${APPLY ? 'APPLY' : 'DRY RUN'} — ${SEGMENTS} segments × ${CONCURRENCY} writes\n`);
  const started = Date.now();
  const progress = setInterval(
    () => console.log(`… ${stats.scanned} timeline rows without keys seen, ${stats.filed} ${APPLY ? 'filed' : 'to file'}`),
    30_000,
  );
  try {
    await Promise.all(Array.from({ length: SEGMENTS }, (_, i) => segment(i)));
  } finally {
    clearInterval(progress);
  }
  const days = [...stats.days].sort();
  console.log(
    `\n${stats.scanned} timeline rows without keys: ${stats.filed} ${APPLY ? 'filed' : 'to file'}, ` +
      `${stats.notActivity} not Activity events (Workiz comments, synthetic rows), ${stats.raced} written meanwhile. ` +
      `${days.length} days${days.length ? ` (${days[0]} … ${days[days.length - 1]})` : ''}, ${Math.round((Date.now() - started) / 1000)}s.`,
  );
  if (APPLY && days.length) {
    console.log(`\nNext: npm run recount:activity -w backend/services/deal -- --from ${days[0]} --apply`);
  }
}

main().catch((err) => {
  console.error('backfill-activity-index failed:', err);
  process.exit(1);
});
