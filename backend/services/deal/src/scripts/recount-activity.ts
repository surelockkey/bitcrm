/**
 * Set the Activity report's day counters from the index itself.
 *
 * WHY
 * ---
 * "Showing 1 to 10 of N" for an unfiltered period is the sum of its days'
 * `ACTCOUNT#<day>` counters; the timeline writer adds one per event it writes.
 * Rows filed by `backfill:activity-index` (or re-imported) are not counted
 * until this runs; a counter can also drift by a lost tick.
 *
 * WHAT
 * ----
 * For every New York day of the range, a `Select: COUNT` Query on
 * ActivityDayIndex (`ACTDAY#<day>`), then `count` on `ACTCOUNT#<day>` / `COUNT`
 * is set to it. Idempotent. Run it after the backfill has finished and the
 * index has caught up (a GSI is eventually consistent — give it a minute).
 *
 * USAGE
 * -----
 *   npm run recount:activity -w backend/services/deal                          # dry run, 2015-01-01 … today
 *   npm run recount:activity -w backend/services/deal -- --from 2026-09-01 --to 2026-09-27 --apply
 */
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../../../../.env') });

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { accountDaysBetween, ACTIVITY_FIRST_DAY, dashboardDay } from '@bitcrm/types';
import { ACTIVITY_DAY_INDEX, activityCountKey, activityDayPk } from '../activity/activity.constants';

const TABLE = process.env.DEALS_TABLE || 'BitCRM_Deals';
const APPLY = process.argv.includes('--apply');
const opt = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const FROM = opt('from') ?? ACTIVITY_FIRST_DAY;
const TO = opt('to') ?? dashboardDay(new Date());
const CONCURRENCY = 16;

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

async function countDay(day: string): Promise<number> {
  let n = 0;
  let startKey: Record<string, unknown> | undefined;
  do {
    const res = await client.send(
      new QueryCommand({
        TableName: TABLE,
        IndexName: ACTIVITY_DAY_INDEX,
        KeyConditionExpression: 'GSI8PK = :pk',
        ExpressionAttributeValues: { ':pk': activityDayPk(day) },
        Select: 'COUNT',
        ExclusiveStartKey: startKey,
      }),
    );
    n += res.Count ?? 0;
    startKey = res.LastEvaluatedKey;
  } while (startKey);
  return n;
}

async function main(): Promise<void> {
  const days = accountDaysBetween(FROM, TO);
  console.log(`Table: ${TABLE}`);
  console.log(`Mode:  ${APPLY ? 'APPLY' : 'DRY RUN'} — ${FROM} … ${TO} (${days.length} days)\n`);
  let total = 0;
  let changed = 0;
  let next = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < days.length) {
        const day = days[next++];
        const n = await countDay(day);
        total += n;
        const stored = (await client.send(new GetCommand({ TableName: TABLE, Key: activityCountKey(day) }))).Item?.count;
        if (stored === n || (stored === undefined && n === 0)) continue;
        changed += 1;
        console.log(`${day}: ${stored ?? '∅'} → ${n}`);
        if (APPLY) {
          await client.send(
            new PutCommand({
              TableName: TABLE,
              Item: { ...activityCountKey(day), count: n, recountedAt: new Date().toISOString() },
            }),
          );
        }
      }
    }),
  );
  console.log(`\n${total} events over ${days.length} days; ${changed} counters ${APPLY ? 'set' : 'to set'}.`);
}

main().catch((err) => {
  console.error('recount-activity failed:', err);
  process.exit(1);
});
