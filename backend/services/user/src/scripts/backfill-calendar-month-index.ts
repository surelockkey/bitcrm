/**
 * Reconcile the calendar month index (`CALDAY#<YYYY-MM>` rows) against the
 * calendar events.
 *
 * WHY
 * ---
 * The schedule grid (`GET /users/technicians/calendar-events`) asked for every
 * technician's events with one Query each, each reaching 60 days back. The
 * month index files a copy of every event under each month it touches, so the
 * grid reads one Query per month of its window instead. The repository keeps
 * it in step on every create / update / move / delete; events written before
 * it existed have no month rows.
 *
 * WHAT
 * ----
 * A derived projection, so this RECONCILES rather than backfills
 * (backend/CLAUDE.md §5): it writes the month rows an event is missing (or
 * holds a stale copy of) AND deletes the month rows no event explains. Rules
 * and keys are the repository's own (`technicians/calendar/calendar-month-index.ts`).
 * Every write is a transaction guarded on the event row as the scan saw it
 * (its `updatedAt`, or its absence for an orphan), so an event edited mid-run
 * — whose own write already moved its month rows — is reported as skipped,
 * never overwritten. Idempotent: a second run changes nothing but the stamp.
 *
 * It refuses to delete anything when the scan found month rows but no events
 * at all — that answer looks like a broken read, not an empty calendar.
 *
 * READINESS
 * ---------
 * A complete `--apply` run ends by stamping `CALMONTHINDEX / STATE
 * { readyAt, count }`. Until that row exists the grid keeps the per-technician
 * queries, so user-service can ship before this has run.
 *
 * USAGE
 * -----
 *   npm run backfill:calendar-month-index -w backend/services/user              # dry run
 *   npm run backfill:calendar-month-index -w backend/services/user -- --apply
 *
 * No Terraform: the index is plain table rows. Run it after the deploy that
 * ships the index, and again after anything writes calendar rows around the
 * repository (an import).
 */
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../../../../.env') });

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  ScanCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  CAL_MONTH_INDEX_STATE_KEY,
  CAL_MONTH_PK_PREFIX,
  lockCondition,
  planCalendarMonthIndex,
} from '../technicians/calendar/calendar-month-index';

const PARALLEL = 10;

type Send = (command: ScanCommand | TransactWriteCommand | PutCommand) => Promise<any>;
type Row = Record<string, unknown>;

export interface CalendarMonthReconcileResult {
  events: number;
  pointers: number;
  same: number;
  /** Month rows written (or, on a dry run, to write). */
  written: number;
  /** Month rows deleted (or to delete). */
  deleted: number;
  /** Changed under the run (condition failed) — their own write moved the month rows. */
  skipped: number;
  /** Set when deletes were refused (month rows but no events scanned); nothing is stamped then. */
  refused?: string;
  readyAt?: string;
}

async function guarded(send: Send, items: any[]): Promise<boolean> {
  try {
    await send(new TransactWriteCommand({ TransactItems: items }));
    return true;
  } catch (err) {
    const e = err as { name?: string; CancellationReasons?: { Code?: string }[] };
    if (
      e.name === 'TransactionCanceledException' &&
      (e.CancellationReasons ?? []).some((r) => r?.Code === 'ConditionalCheckFailed')
    ) {
      return false;
    }
    throw err;
  }
}

export async function reconcileCalendarMonthIndex(
  send: Send,
  opts: { table: string; apply: boolean; log?: (line: string) => void },
): Promise<CalendarMonthReconcileResult> {
  const log = opts.log ?? ((line: string) => console.log(line));

  // Every event row and every month row. A failed page throws — nothing acts
  // on a partial read.
  const rows: Row[] = [];
  let lastKey: Record<string, unknown> | undefined;
  do {
    const page = await send(
      new ScanCommand({
        TableName: opts.table,
        FilterExpression: '(begins_with(PK, :user) AND begins_with(SK, :cal)) OR begins_with(PK, :month)',
        ExpressionAttributeValues: { ':user': 'USER#', ':cal': 'CAL#', ':month': CAL_MONTH_PK_PREFIX },
        ExclusiveStartKey: lastKey,
      }),
    );
    rows.push(...((page.Items ?? []) as Row[]));
    lastKey = page.LastEvaluatedKey;
  } while (lastKey);

  const plan = planCalendarMonthIndex(rows);
  const out: CalendarMonthReconcileResult = {
    events: plan.events,
    pointers: plan.pointers,
    same: plan.same,
    written: 0,
    deleted: 0,
    skipped: 0,
  };

  let deletes = plan.deletes;
  if (plan.events === 0 && plan.pointers > 0) {
    out.refused = `scanned ${plan.pointers} month rows but no calendar events — refusing to delete or stamp`;
    log(out.refused);
    deletes = [];
  }

  if (!opts.apply) {
    out.written = plan.puts.reduce((n, p) => n + p.items.length, 0);
    out.deleted = deletes.length;
    let shown = 0;
    for (const p of plan.puts) {
      for (const item of p.items) if (shown++ < 10) log(`would write ${item.PK} / ${item.SK}`);
    }
    for (const d of deletes) if (shown++ < 20) log(`would delete ${d.pointer.PK} / ${d.pointer.SK}`);
    return out;
  }

  // Writes: per event, its missing month rows, guarded on the event unchanged.
  for (let i = 0; i < plan.puts.length; i += PARALLEL) {
    const slice = plan.puts.slice(i, i + PARALLEL);
    const results = await Promise.all(
      slice.map((p) =>
        guarded(send, [
          {
            ConditionCheck: {
              TableName: opts.table,
              Key: { PK: p.event.PK, SK: p.event.SK },
              ...lockCondition(p.event.updatedAt as string | undefined),
            },
          },
          ...p.items.map((Item) => ({ Put: { TableName: opts.table, Item } })),
        ]),
      ),
    );
    results.forEach((ok, j) => {
      if (ok) out.written += slice[j].items.length;
      else out.skipped += 1;
    });
  }

  // Deletes: a month row no event explains, guarded on its event being as
  // scanned — still absent, or still the version that does not want it.
  for (let i = 0; i < deletes.length; i += PARALLEL) {
    const slice = deletes.slice(i, i + PARALLEL);
    const results = await Promise.all(
      slice.map((d) =>
        guarded(send, [
          {
            ConditionCheck: {
              TableName: opts.table,
              Key: d.event,
              ...(d.eventExists
                ? lockCondition(d.eventUpdatedAt)
                : { ConditionExpression: 'attribute_not_exists(PK)' }),
            },
          },
          { Delete: { TableName: opts.table, Key: d.pointer } },
        ]),
      ),
    );
    results.forEach((ok) => {
      if (ok) out.deleted += 1;
      else out.skipped += 1;
    });
  }

  if (!out.refused) {
    out.readyAt = new Date().toISOString();
    await send(
      new PutCommand({
        TableName: opts.table,
        Item: { ...CAL_MONTH_INDEX_STATE_KEY, readyAt: out.readyAt, count: plan.events },
      }),
    );
    log(`Stamped ${CAL_MONTH_INDEX_STATE_KEY.PK} / ${CAL_MONTH_INDEX_STATE_KEY.SK}: readyAt ${out.readyAt}, count ${plan.events}`);
  }
  return out;
}

async function main(): Promise<void> {
  const table = process.env.USERS_TABLE || 'BitCRM_Users';
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
  const r = await reconcileCalendarMonthIndex((c) => client.send(c as never), { table, apply });
  console.log(
    `\n${r.events} events, ${r.pointers} month rows: ${r.written} ${apply ? 'written' : 'to write'}, ` +
      `${r.deleted} ${apply ? 'deleted' : 'to delete'}, ${r.same} already correct` +
      (apply ? `, ${r.skipped} skipped (edited during the run — their own write moved them)` : '') +
      '.',
  );
  if (r.refused) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((err) => {
    console.error('backfill-calendar-month-index failed:', err);
    process.exit(1);
  });
}
