/**
 * Set the per-month call counters (`CALLCOUNT` / `MONTH#<YYYY-MM>`) from the
 * log itself, and stamp `CALLCOUNT` / `STATE` so `GET /calls/count` starts
 * trusting them.
 *
 * WHY
 * ---
 * An unfiltered or date-only count reads the counters instead of walking up
 * to 140 month partitions (CallsService.count). The service ADDs to a month
 * when a call first enters the log; rows written any other way — the Workiz
 * import, rows from before the counters shipped — are counted only by this.
 * Until it has run with `--apply`, the counters are ignored and the count
 * walks the log as before.
 *
 * WHAT
 * ----
 * For every month from CALLS_MIN_MONTH to now (or `--month YYYY-MM`), counts
 * the log rows exactly as the list counts them — AllCallsIndex
 * `CALL#<YYYY-MM>`, `Select: COUNT`, `attribute_not_exists(internalLegOf)` —
 * with no read budget, six months at a time. Compares with the stored
 * counters and, with `--apply`, SETs every month that differs (a stray month
 * the log no longer has goes to 0). Reconciles, so a second run writes
 * nothing. A call created mid-run in the month being counted can make that
 * month one off; run it again (or with `--month`) to settle it.
 *
 * USAGE
 * -----
 *   npm run recount:calls -w backend/services/telephony                    # dry run: the differences
 *   npm run recount:calls -w backend/services/telephony -- --apply
 *   npm run recount:calls -w backend/services/telephony -- --apply --month 2026-10
 *
 * Dev: AWS_PROFILE=bitcrm-dev AWS_REGION=us-east-1 DYNAMODB_ENDPOINT= CALLS_TABLE=bitcrm-dev-calls …
 *
 * Run it after the deploy that ships the counters, and again after every
 * Workiz import. COST: one COUNT read of the whole log index (~1.8 M rows ≈
 * a few GB of reads, eventually consistent) — minutes from a laptop.
 */
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../../../../.env') });

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import {
  CALLS_GSI2_NAME,
  CALLS_MIN_MONTH,
  CALLS_TABLE,
  monthsDescending,
} from '../common/constants/dynamo.constants';
import {
  CALL_COUNTERS_PK,
  CALL_COUNTERS_STATE_SK,
  callCounterSk,
} from '../calls/call-counters.repository';

export interface RecountChange {
  month: string;
  from: number;
  to: number;
}

/**
 * Which counters to set: every month whose stored value differs from the log
 * (`counted`), and every stored month the log no longer has (to 0). Oldest
 * month first.
 */
export function planRecount(
  counted: ReadonlyMap<string, number>,
  stored: ReadonlyMap<string, number>,
): RecountChange[] {
  const months = new Set([...counted.keys(), ...stored.keys()]);
  return [...months]
    .sort()
    .flatMap((month) => {
      const to = counted.get(month) ?? 0;
      const from = stored.get(month) ?? 0;
      return to === from ? [] : [{ month, from, to }];
    });
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const only = arg('month');
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
  const months = only ? [only] : monthsDescending(CALLS_MIN_MONTH, undefined);
  console.log(`Calls: ${CALLS_TABLE} — ${months.length} month(s), ${apply ? 'APPLY' : 'DRY RUN'}\n`);

  const counted = new Map<string, number>();
  let next = 0;
  const worker = async () => {
    for (;;) {
      const month = months[next];
      next += 1;
      if (!month) return;
      let n = 0;
      let startKey: Record<string, unknown> | undefined;
      do {
        const res = await client.send(
          new QueryCommand({
            TableName: CALLS_TABLE,
            IndexName: CALLS_GSI2_NAME,
            KeyConditionExpression: 'GSI2PK = :pk',
            FilterExpression: 'attribute_not_exists(internalLegOf)',
            ExpressionAttributeValues: { ':pk': `CALL#${month}` },
            Select: 'COUNT',
            ...(startKey && { ExclusiveStartKey: startKey }),
          }),
        );
        n += res.Count ?? 0;
        startKey = res.LastEvaluatedKey;
      } while (startKey);
      if (n) counted.set(month, n);
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));

  const stored = new Map<string, number>();
  let startKey: Record<string, unknown> | undefined;
  do {
    const res = await client.send(
      new QueryCommand({
        TableName: CALLS_TABLE,
        KeyConditionExpression: only ? 'PK = :pk AND SK = :sk' : 'PK = :pk AND begins_with(SK, :month)',
        ExpressionAttributeValues: only
          ? { ':pk': CALL_COUNTERS_PK, ':sk': callCounterSk(only) }
          : { ':pk': CALL_COUNTERS_PK, ':month': 'MONTH#' },
        ...(startKey && { ExclusiveStartKey: startKey }),
      }),
    );
    for (const item of res.Items ?? []) {
      if (typeof item.count === 'number') stored.set(String(item.SK).slice('MONTH#'.length), item.count);
    }
    startKey = res.LastEvaluatedKey;
  } while (startKey);

  const plan = planRecount(counted, stored);
  const total = [...counted.values()].reduce((a, b) => a + b, 0);
  console.log(`${total} calls in the log, ${plan.length} month(s) to ${apply ? 'set' : 'change'}:`);
  for (const c of plan) console.log(`  ${c.month}: ${c.from} → ${c.to}`);

  if (!apply) {
    console.log('\nDry run — nothing written. Re-run with --apply.');
    return;
  }
  for (const c of plan) {
    await client.send(
      new PutCommand({
        TableName: CALLS_TABLE,
        Item: { PK: CALL_COUNTERS_PK, SK: callCounterSk(c.month), count: c.to, recountedAt: new Date().toISOString() },
      }),
    );
  }
  if (!only) {
    await client.send(
      new PutCommand({
        TableName: CALLS_TABLE,
        Item: { PK: CALL_COUNTERS_PK, SK: CALL_COUNTERS_STATE_SK, readyAt: new Date().toISOString() },
      }),
    );
    console.log('\nCounters set; CALLCOUNT/STATE stamped — /calls/count now reads them.');
  } else {
    console.log(`\n${only} set.`);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('recount-calls failed:', err);
    process.exit(1);
  });
}
