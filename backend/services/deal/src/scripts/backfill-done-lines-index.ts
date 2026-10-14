/**
 * Reconcile the Done-lines keys (GSI7 on the jobs' `PRODUCT#` rows).
 *
 * WHY
 * ---
 * The Items and services report (`GET /deals/report/items`) reads the Done
 * jobs of its period and then their lines — one Query per job, hundreds of
 * sequential rounds for a quarter. `DONELINES#<YYYY-MM>` / `<day>#DEAL#<id>#
 * <lineKey>` on the EndIndex (keys in `deals/done-lines-index.ts`) puts the
 * lines of a month's Done jobs in one partition: a Query per month. The
 * repositories write it on every line write and restamp a job's lines when it
 * enters / leaves Done or moves day. Lines written before it — every imported
 * Workiz line — have none.
 *
 * WHAT
 * ----
 * A derived projection, so this RECONCILES (backend/CLAUDE.md §5): it sets the
 * keys on the lines of live Done jobs, moves those whose job's day changed,
 * and removes them from lines whose job is no longer live and Done (or whose
 * job row is gone). One Scan collects the jobs' METADATA (their day) and the
 * line rows' keys. Before any write the job is read again, strongly
 * consistent, and the plan made from it as it is now; each write is guarded
 * on the line's keys as the scan saw them, so a line its own live write
 * restamped mid-run is reported as skipped, never overwritten. Idempotent: a
 * second run changes nothing but the readiness stamp.
 *
 * READINESS
 * ---------
 * A complete `--apply` run ends by stamping `DONELINESINDEX / STATE
 * { readyAt, count }`. Until that row exists the report keeps reading one
 * Query per job, so deal-service can ship before this backfill. No Terraform:
 * the EndIndex (GSI7) exists already.
 *
 * USAGE
 * -----
 *   npm run backfill:done-lines-index -w backend/services/deal              # dry run
 *   npm run backfill:done-lines-index -w backend/services/deal -- --apply
 *
 * Run it after the deploy that ships the keys, and again after every Workiz
 * import (the importer writes lines without them).
 */
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../../../../.env') });

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import {
  DONE_LINES_DEAL_PROJECTION,
  DONE_LINES_STATE_KEY,
  doneLineWrite,
  doneLinesDay,
  planDoneLine,
  type DoneLinePlan,
} from '../deals/done-lines-index';

const PARALLEL = 10;

type Send = (command: ScanCommand | UpdateCommand | PutCommand | GetCommand) => Promise<any>;
type Row = Record<string, unknown> & { PK: string; SK: string };

export interface ReconcileDoneLinesResult {
  /** Deal METADATA rows seen. */
  deals: number;
  /** `PRODUCT#` rows seen. */
  lines: number;
  same: number;
  set: number;
  removed: number;
  /** Changed under the run (condition failed) — their own write restamped them. */
  skipped: number;
  /** Lines that belong in the index as scanned — the readiness row's `count`. */
  qualifying: number;
  /** When `--apply` stamped `DONELINESINDEX / STATE` (never on a dry run). */
  readyAt?: string;
}

const isMeta = (r: Row) => r.SK === 'METADATA' && typeof r.PK === 'string' && r.PK.startsWith('DEAL#');
const isLine = (r: Row) => typeof r.SK === 'string' && r.SK.startsWith('PRODUCT#') && typeof r.PK === 'string' && r.PK.startsWith('DEAL#');
const dealIdOf = (r: Row) => r.PK.slice('DEAL#'.length);

/** The line's keys as the scan saw them — what the write is guarded on. */
function guardOf(line: Row) {
  return line.GSI7SK === undefined
    ? { expression: 'attribute_not_exists(GSI7SK)' }
    : { expression: 'GSI7SK = :was', values: { ':was': line.GSI7SK } };
}

export async function reconcileDoneLines(
  send: Send,
  opts: { table: string; apply: boolean; log?: (line: string) => void },
): Promise<ReconcileDoneLinesResult> {
  const log = opts.log ?? ((line: string) => console.log(line));
  const out: ReconcileDoneLinesResult = { deals: 0, lines: 0, same: 0, set: 0, removed: 0, skipped: 0, qualifying: 0 };
  const dayOf = new Map<string, string | undefined>();
  const lines: Row[] = [];
  let lastKey: Record<string, unknown> | undefined;
  let scanned = 0;

  do {
    const page = await send(
      new ScanCommand({
        TableName: opts.table,
        FilterExpression: '(SK = :meta AND begins_with(PK, :deal)) OR begins_with(SK, :product)',
        ExpressionAttributeValues: { ':meta': 'METADATA', ':deal': 'DEAL#', ':product': 'PRODUCT#' },
        ProjectionExpression: 'PK, SK, id, #status, superStatus, stage, scheduledDate, createdAt, GSI7PK, GSI7SK',
        ExpressionAttributeNames: { '#status': 'status' },
        ExclusiveStartKey: lastKey,
      }),
    );
    for (const row of (page.Items ?? []) as Row[]) {
      scanned += 1;
      if (isMeta(row)) {
        out.deals += 1;
        dayOf.set(dealIdOf(row), doneLinesDay(row));
      } else if (isLine(row)) {
        lines.push({ PK: row.PK, SK: row.SK, GSI7PK: row.GSI7PK, GSI7SK: row.GSI7SK });
      }
    }
    lastKey = page.LastEvaluatedKey;
    if (scanned % 50_000 < (page.Items?.length ?? 0)) log(`… ${scanned} rows scanned`);
  } while (lastKey);

  // What each line needs, by its job as scanned.
  const todo = new Map<string, Row[]>();
  for (const line of lines) {
    out.lines += 1;
    const day = dayOf.get(dealIdOf(line));
    if (day) out.qualifying += 1;
    const plan = planDoneLine(line, day);
    if (plan.action === 'same') {
      out.same += 1;
      continue;
    }
    const list = todo.get(dealIdOf(line));
    if (list) list.push(line);
    else todo.set(dealIdOf(line), [line]);
  }

  let shown = 0;
  const jobs = [...todo.entries()];
  if (!opts.apply) {
    for (const [, rows] of jobs) {
      for (const line of rows) {
        const plan = planDoneLine(line, dayOf.get(dealIdOf(line))) as Exclude<DoneLinePlan, { action: 'same' }>;
        if (plan.action === 'set') out.set += 1;
        else out.removed += 1;
        if (shown++ < 10) log(`would ${plan.action} ${line.PK} ${line.SK}${plan.action === 'set' ? `: ${plan.pk} / ${plan.sk}` : ''}`);
      }
    }
  } else {
    for (let i = 0; i < jobs.length; i += PARALLEL) {
      await Promise.all(
        jobs.slice(i, i + PARALLEL).map(async ([dealId, rows]) => {
          // The job as it is now — a status move since the scan decides.
          const fresh = await send(
            new GetCommand({
              TableName: opts.table,
              Key: { PK: `DEAL#${dealId}`, SK: 'METADATA' },
              ProjectionExpression: DONE_LINES_DEAL_PROJECTION,
              ExpressionAttributeNames: { '#status': 'status' },
              ConsistentRead: true,
            }),
          );
          const day = fresh.Item ? doneLinesDay(fresh.Item) : undefined;
          for (const line of rows) {
            const plan = planDoneLine(line, day);
            if (plan.action === 'same') {
              out.same += 1;
              continue;
            }
            try {
              await send(new UpdateCommand(doneLineWrite(opts.table, line, plan, guardOf(line))));
              if (plan.action === 'set') out.set += 1;
              else out.removed += 1;
            } catch (err) {
              if ((err as { name?: string }).name !== 'ConditionalCheckFailedException') throw err;
              out.skipped += 1;
            }
          }
        }),
      );
    }
  }

  // The whole table reconciled: the report may switch to the index. A run
  // that threw never gets here, and a dry run never stamps.
  if (opts.apply) {
    out.readyAt = new Date().toISOString();
    await send(
      new PutCommand({ TableName: opts.table, Item: { ...DONE_LINES_STATE_KEY, readyAt: out.readyAt, count: out.qualifying } }),
    );
    log(`Stamped ${DONE_LINES_STATE_KEY.PK} / ${DONE_LINES_STATE_KEY.SK}: readyAt ${out.readyAt}, count ${out.qualifying}`);
  }
  return out;
}

async function main(): Promise<void> {
  const table = process.env.DEALS_TABLE || 'BitCRM_Deals';
  const apply = process.argv.includes('--apply');
  const client = DynamoDBDocumentClient.from(
    new DynamoDBClient({
      region: process.env.AWS_REGION || 'us-east-1',
      ...(process.env.DYNAMODB_ENDPOINT && {
        endpoint: process.env.DYNAMODB_ENDPOINT,
        credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
      }),
    }),
    { marshallOptions: { removeUndefinedValues: true } },
  );
  console.log(`Table: ${table}`);
  console.log(`Mode:  ${apply ? 'APPLY' : 'DRY RUN (pass --apply to write)'}\n`);
  const r = await reconcileDoneLines((c) => client.send(c as never), { table, apply });
  console.log(
    `\nScanned ${r.deals} deals, ${r.lines} lines: ${r.set} ${apply ? 'filed' : 'to file'}, ` +
      `${r.removed} ${apply ? 'removed' : 'to remove'}, ${r.same} already correct` +
      (apply ? `, ${r.skipped} skipped (rewritten during the run — their own write restamped them)` : '') +
      '.',
  );
}

if (require.main === module) {
  main().catch((err) => {
    console.error('backfill-done-lines-index failed:', err);
    process.exit(1);
  });
}
