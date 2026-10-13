/**
 * Stamp `dealTotal` on every call linked to a job, and file each link under
 * its job (`DEALCALLS#<dealId>` / `CALL#<sid>`).
 *
 * WHY
 * ---
 * The call reports (stats/summary, Call Tracking, the CSV export) read a
 * linked job's total off the call row; only rows without one are priced by
 * asking deal-service. The service stamps it when a call is linked and keeps
 * it fresh from deal-events, which find a job's calls through the DEALCALLS#
 * rows. Calls linked before that shipped — and every imported Workiz call —
 * have neither: until this runs they cost the reports a deal-service round
 * trip, and a later change to their job does not reach them.
 *
 * WHAT
 * ----
 * 1. Scans the calls table (`--segments` parallel segments) for `CALL#…` /
 *    METADATA rows that carry a `dealId`.
 * 2. Puts the DEALCALLS# row of each link, conditional on it not existing.
 * 3. Reads the jobs' totals straight from the deals table (BatchGet,
 *    projected) with deal-service's own rule (`totals.total`, else an
 *    imported job's `jobTotalPrice`, else 0; a job the table no longer holds
 *    is 0 — what the reports always counted it as).
 * 4. Stamps `dealTotal` + `dealTotalAt`, conditional on the call still being
 *    on that job AND carrying no total yet — never over a live write.
 *    `--refresh` also corrects a stamped total that differs.
 *
 * Idempotent, upsert-only (backend/CLAUDE.md §5): a second run writes nothing.
 *
 * USAGE
 * -----
 *   npm run backfill:call-deal-totals -w backend/services/telephony                 # dry run: counts + samples
 *   npm run backfill:call-deal-totals -w backend/services/telephony -- --apply
 *     [--refresh]          also rewrite stamped totals that differ from the job's
 *     [--segments 8]       parallel Scan segments over the calls table
 *     [--concurrency 50]   writes in flight
 *
 * Dev: AWS_PROFILE=bitcrm-dev AWS_REGION=us-east-1 DYNAMODB_ENDPOINT= \
 *      CALLS_TABLE=bitcrm-dev-calls DEALS_TABLE=bitcrm-dev-deals npm run backfill:call-deal-totals …
 *
 * Run it after the deploy that ships the stamp (and the deal-events queue),
 * and again after every Workiz import. COST: one Scan of the calls table plus
 * one UpdateItem per linked call (≈4 writes each — the row's ALL-projected
 * GSIs) and one small Put per link.
 */
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../../../../.env') });

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  BatchGetCommand,
  DynamoDBDocumentClient,
  PutCommand,
  ScanCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { dealCallsPk } from '../common/constants/dynamo.constants';

const CALLS_TABLE = process.env.CALLS_TABLE || 'BitCRM_Calls';
const DEALS_TABLE = process.env.DEALS_TABLE || 'BitCRM_Deals';

/** deal-service's `dealTotalOf` (deal-totals.repository.ts), verbatim in effect. */
export function dealTotalOf(item: Record<string, unknown> | undefined): number {
  if (!item) return 0;
  const totals = item.totals as { total?: unknown } | undefined;
  if (typeof totals?.total === 'number' && Number.isFinite(totals.total)) return totals.total;
  if (typeof item.jobTotalPrice === 'number' && Number.isFinite(item.jobTotalPrice)) return item.jobTotalPrice;
  return 0;
}

export interface LinkedCallRow {
  PK: string;
  dealId?: unknown;
  dealTotal?: unknown;
}

/** What one linked call needs. */
export function planDealTotal(
  row: LinkedCallRow,
  totals: ReadonlyMap<string, number>,
  refresh: boolean,
): { action: 'skip' } | { action: 'set'; dealId: string; total: number } {
  const dealId = typeof row.dealId === 'string' && row.dealId ? row.dealId : undefined;
  if (!dealId) return { action: 'skip' };
  const total = totals.get(dealId) ?? 0;
  const stamped = typeof row.dealTotal === 'number' ? row.dealTotal : undefined;
  if (stamped === undefined) return { action: 'set', dealId, total };
  if (refresh && stamped !== total) return { action: 'set', dealId, total };
  return { action: 'skip' };
}

function flag(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  const n = i >= 0 ? Number(process.argv[i + 1]) : NaN;
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

const isCcf = (err: unknown) => (err as { name?: string })?.name === 'ConditionalCheckFailedException';

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const refresh = process.argv.includes('--refresh');
  const segments = flag('segments', 8);
  const concurrency = flag('concurrency', 50);
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
  const started = Date.now();
  console.log(`Calls: ${CALLS_TABLE}   Deals: ${DEALS_TABLE}`);
  console.log(`Mode:  ${apply ? 'APPLY' : 'DRY RUN'}${refresh ? ' + refresh' : ''} (segments ${segments}, concurrency ${concurrency})\n`);

  // 1. Every linked call.
  const rows: LinkedCallRow[] = [];
  await Promise.all(
    Array.from({ length: segments }, async (_, segment) => {
      let lastKey: Record<string, unknown> | undefined;
      do {
        const page = await client.send(
          new ScanCommand({
            TableName: CALLS_TABLE,
            Segment: segment,
            TotalSegments: segments,
            FilterExpression: '#sk = :meta AND begins_with(#pk, :call) AND attribute_exists(#dealId)',
            ExpressionAttributeNames: { '#pk': 'PK', '#sk': 'SK', '#dealId': 'dealId', '#dealTotal': 'dealTotal' },
            ExpressionAttributeValues: { ':meta': 'METADATA', ':call': 'CALL#' },
            ProjectionExpression: '#pk, #dealId, #dealTotal',
            ExclusiveStartKey: lastKey,
          }),
        );
        rows.push(...((page.Items ?? []) as LinkedCallRow[]));
        lastKey = page.LastEvaluatedKey;
      } while (lastKey);
    }),
  );
  console.log(`${rows.length} linked calls found`);

  // 2. The jobs' totals, for the rows that need one.
  const wanted = [
    ...new Set(
      rows
        .filter((r) => refresh || typeof r.dealTotal !== 'number')
        .map((r) => r.dealId)
        .filter((id): id is string => typeof id === 'string' && !!id),
    ),
  ];
  const totals = new Map<string, number>();
  for (let i = 0; i < wanted.length; i += 100) {
    let keys: Record<string, unknown>[] = wanted.slice(i, i + 100).map((id) => ({ PK: `DEAL#${id}`, SK: 'METADATA' }));
    for (let attempt = 0; keys.length && attempt < 8; attempt += 1) {
      if (attempt) await new Promise((r) => setTimeout(r, 100 * 2 ** attempt));
      const res = await client.send(
        new BatchGetCommand({
          RequestItems: {
            [DEALS_TABLE]: {
              Keys: keys,
              ProjectionExpression: '#id, #totals, #jobTotalPrice',
              ExpressionAttributeNames: { '#id': 'id', '#totals': 'totals', '#jobTotalPrice': 'jobTotalPrice' },
            },
          },
        }),
      );
      for (const item of res.Responses?.[DEALS_TABLE] ?? []) {
        if (typeof item.id === 'string') totals.set(item.id, dealTotalOf(item));
      }
      keys = (res.UnprocessedKeys?.[DEALS_TABLE]?.Keys ?? []) as Record<string, unknown>[];
    }
  }
  console.log(`${totals.size} of ${wanted.length} jobs read (the rest are gone → 0)\n`);

  // 3. Index rows + stamps.
  const counts = { indexed: 0, indexedAlready: 0, stamped: 0, skipped: 0, raced: 0 };
  let samples = 0;
  const at = new Date().toISOString();
  const work = rows.map((row) => async () => {
    const callSid = row.PK.slice('CALL#'.length);
    const dealId = row.dealId as string;
    const plan = planDealTotal(row, totals, refresh);
    if (!apply) {
      if (plan.action === 'set') {
        counts.stamped += 1;
        if (samples++ < 5) console.log(`would stamp ${callSid}: job ${plan.dealId} → ${plan.total}`);
      } else counts.skipped += 1;
      return;
    }
    try {
      await client.send(
        new PutCommand({
          TableName: CALLS_TABLE,
          Item: { PK: dealCallsPk(dealId), SK: row.PK, dealId, callSid, linkedAt: at },
          ConditionExpression: 'attribute_not_exists(PK)',
        }),
      );
      counts.indexed += 1;
    } catch (err) {
      if (!isCcf(err)) throw err;
      counts.indexedAlready += 1;
    }
    if (plan.action !== 'set') {
      counts.skipped += 1;
      return;
    }
    try {
      await client.send(
        new UpdateCommand({
          TableName: CALLS_TABLE,
          Key: { PK: row.PK, SK: 'METADATA' },
          UpdateExpression: 'SET #dealTotal = :total, #dealTotalAt = :at',
          ConditionExpression: refresh
            ? '#dealId = :dealId AND (attribute_not_exists(#dealTotal) OR #dealTotal <> :total)'
            : '#dealId = :dealId AND attribute_not_exists(#dealTotal)',
          ExpressionAttributeNames: { '#dealId': 'dealId', '#dealTotal': 'dealTotal', '#dealTotalAt': 'dealTotalAt' },
          ExpressionAttributeValues: { ':dealId': plan.dealId, ':total': plan.total, ':at': at },
        }),
      );
      counts.stamped += 1;
    } catch (err) {
      if (!isCcf(err)) throw err;
      counts.raced += 1;
    }
  });
  for (let i = 0; i < work.length; i += concurrency) {
    await Promise.all(work.slice(i, i + concurrency).map((job) => job()));
  }

  console.log(
    `\n${Math.round((Date.now() - started) / 1000)} s: ${counts.stamped} ${apply ? 'stamped' : 'to stamp'}, ` +
      `${counts.skipped} already stamped` +
      (apply
        ? `, ${counts.raced} changed under us (left alone); ${counts.indexed} links filed, ${counts.indexedAlready} already filed`
        : '') +
      '.',
  );
}

if (require.main === module) {
  main().catch((err) => {
    console.error('backfill-call-deal-totals failed:', err);
    process.exit(1);
  });
}
