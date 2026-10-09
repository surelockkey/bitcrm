/**
 * Move every job closed BEFORE the "Update Job End Time" rule existed to its
 * closing moment, as the rule now does on every Done / Canceled.
 *
 * WHY
 * ---
 * Workiz's Account → Preferences "Update Job End Time" is ON: a job marked
 * Done or Canceled ends at that moment, and the "Job end date" reports — the
 * account's default report basis — list it on the day it was closed. BitCRM
 * closed jobs without touching their end until `DealsService.moveStatus`
 * learned the rule; the jobs closed here before that still end on their
 * planned slot and are reported on the wrong day.
 *
 * WHAT
 * ----
 * Scans the closed METADATA rows (Done / Canceled with `closedAt`), computes
 * the same patch the service writes (`closeEndPatch`: the end day, the slot's
 * end, `jobEndDateUtc` + the zone it was read on) and the EndIndex keys for
 * it, and writes only rows whose end differs. Idempotent and upsert-only
 * (backend/CLAUDE.md §5); each write is conditional on the row's `updatedAt`
 * as the scan saw it, so a job edited mid-run is skipped, never overwritten.
 *
 * An imported job carries Workiz's own end (`jobEndDateUtc`), which Workiz
 * already moved when the job was closed there and which the reports are
 * checked against — those rows are LEFT ALONE, unless `--since <ISO>` says
 * the job closed here, after the import (its `closedAt` is at or after it).
 *
 * The zone of a job without one of its own is its service area's (the
 * `SERVICE_AREA#` rows are read once), else the account's.
 *
 * USAGE
 * -----
 *   npm run backfill:close-end-time -w backend/services/deal                      # dry run
 *   npm run backfill:close-end-time -w backend/services/deal -- --apply
 *   npm run backfill:close-end-time -w backend/services/deal -- --apply --since 2026-09-23T00:00:00.000Z
 *
 * Run it once after the deploy that ships the rule (and `--since <the last
 * import>` on an environment where imported jobs were closed in BitCRM).
 */
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../../../../.env') });

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { CLOSED_SUPER_STATUSES, type JobSuperStatus } from '@bitcrm/types';
import { endIndexKeys } from '../deals/deals.repository';
import { closeEndApplied, closeEndPatch, type CloseEndPatch, type CloseEndSource } from '../deals/close-end-time';
import { DEALS_GSI1_NAME } from '../common/constants/dynamo.constants';

const TABLE = process.env.DEALS_TABLE || 'BitCRM_Deals';
const APPLY = process.argv.includes('--apply');
const SINCE = (() => {
  const i = process.argv.indexOf('--since');
  return i >= 0 ? process.argv[i + 1] : undefined;
})();
const PARALLEL = 25;

export type CloseEndRow = CloseEndSource & {
  PK: string;
  SK: string;
  id: string;
  updatedAt?: string;
  createdAt?: string;
  superStatus?: string;
  closedAt?: string;
  jobEndDateUtc?: string;
  jobDateUtc?: string;
  serviceAreaId?: string;
  GSI7PK?: string;
  GSI7SK?: string;
};

export type CloseEndPlan =
  | { action: 'skip'; reason: 'open' | 'no_closed_at' | 'imported' | 'same' }
  | { action: 'set'; patch: CloseEndPatch; keys: { GSI7PK: string; GSI7SK: string } | undefined };

/** What one row needs: nothing (and why), or the patch and the EndIndex keys that go with it. */
export function planCloseEnd(row: CloseEndRow, opts: { areaTimezone?: string; since?: string }): CloseEndPlan {
  if (!row.superStatus || !CLOSED_SUPER_STATUSES.has(row.superStatus as JobSuperStatus)) return { action: 'skip', reason: 'open' };
  if (!row.closedAt) return { action: 'skip', reason: 'no_closed_at' };
  // Workiz's own end on an imported job, unless the job closed here after the import.
  const closedHere = opts.since !== undefined && row.closedAt >= opts.since;
  if (row.jobEndDateUtc && row.jobEndDateUtc !== row.closedAt && !closedHere) return { action: 'skip', reason: 'imported' };

  const patch = closeEndPatch(row, row.closedAt, opts.areaTimezone);
  const keys = endIndexKeys({ ...row, ...patch, id: row.id });
  const keysSame = keys ? row.GSI7PK === keys.GSI7PK && row.GSI7SK === keys.GSI7SK : row.GSI7PK === undefined;
  if (closeEndApplied(row as unknown as Record<string, unknown>, patch) && keysSame) return { action: 'skip', reason: 'same' };
  return { action: 'set', patch, keys };
}

const client = DynamoDBDocumentClient.from(
  new DynamoDBClient({
    region: process.env.AWS_REGION || 'us-east-1',
    ...(process.env.DYNAMODB_ENDPOINT && {
      endpoint: process.env.DYNAMODB_ENDPOINT,
      credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
    }),
  }),
);

/** Service area id → its zone, read once off the catalog partition. */
async function areaTimezones(): Promise<Map<string, string>> {
  const zones = new Map<string, string>();
  let startKey: Record<string, unknown> | undefined;
  do {
    const page = await client.send(
      new QueryCommand({
        TableName: TABLE,
        IndexName: DEALS_GSI1_NAME,
        KeyConditionExpression: 'GSI1PK = :pk',
        ExpressionAttributeValues: { ':pk': 'CATALOG#SERVICE_AREA' },
        ProjectionExpression: 'id, #tz',
        ExpressionAttributeNames: { '#tz': 'timezone' },
        ExclusiveStartKey: startKey,
      }),
    );
    for (const item of page.Items ?? []) {
      if (typeof item.id === 'string' && typeof item.timezone === 'string') zones.set(item.id, item.timezone);
    }
    startKey = page.LastEvaluatedKey;
  } while (startKey);
  return zones;
}

async function write(row: CloseEndRow, plan: Extract<CloseEndPlan, { action: 'set' }>): Promise<'moved' | 'skipped'> {
  const sets: string[] = [];
  const values: Record<string, unknown> = {};
  const names: Record<string, string> = {};
  for (const [key, value] of Object.entries(plan.patch)) {
    names[`#${key}`] = key;
    values[`:${key}`] = value;
    sets.push(`#${key} = :${key}`);
  }
  if (plan.keys) {
    sets.push('GSI7PK = :gsi7pk', 'GSI7SK = :gsi7sk');
    values[':gsi7pk'] = plan.keys.GSI7PK;
    values[':gsi7sk'] = plan.keys.GSI7SK;
  }
  const condition = row.updatedAt ? 'attribute_exists(PK) AND updatedAt = :seen' : 'attribute_exists(PK) AND attribute_not_exists(updatedAt)';
  if (row.updatedAt) values[':seen'] = row.updatedAt;
  try {
    await client.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: { PK: row.PK, SK: row.SK },
        UpdateExpression: `SET ${sets.join(', ')}${plan.keys ? '' : ' REMOVE GSI7PK, GSI7SK'}`,
        ConditionExpression: condition,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
      }),
    );
    return 'moved';
  } catch (err) {
    if ((err as { name?: string }).name === 'ConditionalCheckFailedException') return 'skipped';
    throw err;
  }
}

async function main(): Promise<void> {
  console.log(`Table: ${TABLE}`);
  console.log(`Mode:  ${APPLY ? 'APPLY' : 'DRY RUN'}${SINCE ? `, imported jobs closed since ${SINCE} included` : ''}\n`);
  if (SINCE && Number.isNaN(Date.parse(SINCE))) throw new Error(`--since must be an ISO instant, got "${SINCE}"`);

  const zones = await areaTimezones();
  console.log(`${zones.size} service areas with a zone\n`);

  let scanned = 0;
  let moved = 0;
  let skipped = 0;
  const reasons: Record<string, number> = { open: 0, no_closed_at: 0, imported: 0, same: 0 };
  let lastKey: Record<string, unknown> | undefined;

  do {
    const page = await client.send(
      new ScanCommand({
        TableName: TABLE,
        FilterExpression: 'SK = :meta AND begins_with(PK, :deal) AND attribute_exists(closedAt)',
        ExpressionAttributeValues: { ':meta': 'METADATA', ':deal': 'DEAL#' },
        ProjectionExpression:
          'PK, SK, id, updatedAt, createdAt, superStatus, closedAt, scheduledDate, scheduledEndDate, scheduledTimeSlot, allDay, ' +
          'jobDateUtc, jobEndDateUtc, jobTimezone, serviceAreaId, GSI7PK, GSI7SK',
        ExclusiveStartKey: lastKey,
      }),
    );

    const todo: { row: CloseEndRow; plan: Extract<CloseEndPlan, { action: 'set' }> }[] = [];
    for (const item of (page.Items ?? []) as CloseEndRow[]) {
      scanned += 1;
      const plan = planCloseEnd(item, { areaTimezone: item.serviceAreaId ? zones.get(item.serviceAreaId) : undefined, since: SINCE });
      if (plan.action === 'skip') reasons[plan.reason] += 1;
      else todo.push({ row: item, plan });
    }

    if (!APPLY) {
      moved += todo.length;
      for (const t of todo.slice(0, 5)) {
        console.log(
          `would move ${t.row.PK}: ${t.row.scheduledEndDate ?? '—'} ${t.row.scheduledTimeSlot ?? ''} → ` +
            `${t.plan.patch.scheduledEndDate ?? '—'} ${t.plan.patch.scheduledTimeSlot ?? ''} (closed ${t.row.closedAt})`,
        );
      }
    } else {
      for (let i = 0; i < todo.length; i += PARALLEL) {
        const results = await Promise.all(todo.slice(i, i + PARALLEL).map((t) => write(t.row, t.plan)));
        moved += results.filter((r) => r === 'moved').length;
        skipped += results.filter((r) => r === 'skipped').length;
      }
    }
    lastKey = page.LastEvaluatedKey;
    if (scanned % 20_000 < (page.Items?.length ?? 0)) console.log(`… ${scanned} closed jobs scanned`);
  } while (lastKey);

  console.log(
    `\nScanned ${scanned} closed jobs: ${moved} ${APPLY ? 'moved' : 'to move'}, ${reasons.same} already at their closing moment, ` +
      `${reasons.imported} imported (Workiz's own end, left alone), ${reasons.no_closed_at} without closedAt` +
      (APPLY ? `, ${skipped} skipped (edited during the run)` : '') +
      '.',
  );
}

if (require.main === module) {
  main().catch((err) => {
    console.error('backfill-close-end-time failed:', err);
    process.exit(1);
  });
}
