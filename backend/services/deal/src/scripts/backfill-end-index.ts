/**
 * Stamp the EndIndex (GSI7) keys onto every deal METADATA row.
 *
 * WHY
 * ---
 * The Jobs report's "By: Job end date" (Workiz `report_by=3`) windows on the
 * visit's END on the account's clock. That is not the start (a multi-day job
 * ends weeks later, so no window on the schedule index finds it) and not the
 * closing moment (`closedAt`: 3 619 September jobs where Workiz lists 3 498).
 * GSI7 (`END#<YYYY-MM>` / `<jobEndAt>#DEAL#<id>`) is that date as a key. The
 * repository writes it on every create and every scheduling update; rows
 * written before the index existed — every imported Workiz job among them —
 * have none, and a row without the keys is absent from the report.
 *
 * WHAT
 * ----
 * Scans METADATA rows, computes the keys with the same `endIndexKeys` the
 * repository uses, and writes only rows whose stored keys differ. Idempotent
 * and upsert-only (backend/CLAUDE.md §5). Each write is conditional on the
 * row's `updatedAt` as the scan saw it: a job edited mid-run was restamped by
 * its own write and is reported as skipped, never overwritten with stale keys.
 *
 * USAGE
 * -----
 *   npm run backfill:end-index -w backend/services/deal            # dry run
 *   npm run backfill:end-index -w backend/services/deal -- --apply
 *
 * Needs the index first: Terraform (`infra/dev/data_plane.tf`, EndIndex n = 7)
 * or `npm run setup:db` locally. Run it after the deploy that ships the index
 * and again after every Workiz import.
 */
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../../../../.env') });

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { endIndexKeys } from '../deals/deals.repository';
import { type ReportDateSource } from '../deals/report/report-dates';

const TABLE = process.env.DEALS_TABLE || 'BitCRM_Deals';
const APPLY = process.argv.includes('--apply');
const PARALLEL = 25;

const client = DynamoDBDocumentClient.from(
  new DynamoDBClient({
    region: process.env.AWS_REGION || 'us-east-1',
    ...(process.env.DYNAMODB_ENDPOINT && {
      endpoint: process.env.DYNAMODB_ENDPOINT,
      credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
    }),
  }),
);

type Row = ReportDateSource & { PK: string; SK: string; id: string; updatedAt?: string; GSI7PK?: string; GSI7SK?: string };

/** What one row needs: nothing, new keys, or its keys removed. */
export function planEndIndex(row: Row): { action: 'same' } | { action: 'set'; pk: string; sk: string } | { action: 'remove' } {
  const keys = endIndexKeys(row);
  if (keys) {
    return row.GSI7PK === keys.GSI7PK && row.GSI7SK === keys.GSI7SK ? { action: 'same' } : { action: 'set', pk: keys.GSI7PK, sk: keys.GSI7SK };
  }
  return row.GSI7PK === undefined && row.GSI7SK === undefined ? { action: 'same' } : { action: 'remove' };
}

async function write(row: Row, plan: { action: 'set'; pk: string; sk: string } | { action: 'remove' }): Promise<'stamped' | 'skipped'> {
  const condition = row.updatedAt ? 'attribute_exists(PK) AND updatedAt = :seen' : 'attribute_exists(PK) AND attribute_not_exists(updatedAt)';
  try {
    await client.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: { PK: row.PK, SK: row.SK },
        UpdateExpression: plan.action === 'set' ? 'SET GSI7PK = :pk, GSI7SK = :sk' : 'REMOVE GSI7PK, GSI7SK',
        ConditionExpression: condition,
        ExpressionAttributeValues: {
          ...(plan.action === 'set' && { ':pk': plan.pk, ':sk': plan.sk }),
          ...(row.updatedAt && { ':seen': row.updatedAt }),
        },
      }),
    );
    return 'stamped';
  } catch (err) {
    if ((err as { name?: string }).name === 'ConditionalCheckFailedException') return 'skipped';
    throw err;
  }
}

async function main(): Promise<void> {
  console.log(`Table: ${TABLE}`);
  console.log(`Mode:  ${APPLY ? 'APPLY' : 'DRY RUN'}\n`);

  let scanned = 0;
  let same = 0;
  let stamped = 0;
  let skipped = 0;
  let lastKey: Record<string, unknown> | undefined;

  do {
    const page = await client.send(
      new ScanCommand({
        TableName: TABLE,
        FilterExpression: 'SK = :meta AND begins_with(PK, :deal)',
        ExpressionAttributeValues: { ':meta': 'METADATA', ':deal': 'DEAL#' },
        ProjectionExpression:
          'PK, SK, id, updatedAt, createdAt, scheduledDate, scheduledEndDate, scheduledTimeSlot, allDay, jobDateUtc, jobEndDateUtc, jobTimezone, GSI7PK, GSI7SK',
        ExclusiveStartKey: lastKey,
      }),
    );

    const todo: { row: Row; plan: { action: 'set'; pk: string; sk: string } | { action: 'remove' } }[] = [];
    for (const item of (page.Items ?? []) as Row[]) {
      scanned += 1;
      const plan = planEndIndex(item);
      if (plan.action === 'same') same += 1;
      else todo.push({ row: item, plan });
    }

    if (!APPLY) {
      stamped += todo.length;
      for (const t of todo.slice(0, 5)) console.log(`would ${t.plan.action} ${t.row.PK}${t.plan.action === 'set' ? `: ${t.plan.sk}` : ''}`);
    } else {
      for (let i = 0; i < todo.length; i += PARALLEL) {
        const results = await Promise.all(todo.slice(i, i + PARALLEL).map((t) => write(t.row, t.plan)));
        stamped += results.filter((r) => r === 'stamped').length;
        skipped += results.filter((r) => r === 'skipped').length;
      }
    }
    lastKey = page.LastEvaluatedKey;
    if (scanned % 20_000 < (page.Items?.length ?? 0)) console.log(`… ${scanned} deals scanned`);
  } while (lastKey);

  console.log(
    `\nScanned ${scanned} deals: ${stamped} ${APPLY ? 'stamped' : 'to stamp'}, ${same} already correct` +
      (APPLY ? `, ${skipped} skipped (edited during the run — their own write stamped them)` : '') +
      '.',
  );
}

if (require.main === module) {
  main().catch((err) => {
    console.error('backfill-end-index failed:', err);
    process.exit(1);
  });
}
