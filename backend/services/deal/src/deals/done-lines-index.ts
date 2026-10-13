import { QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { DealStatus, JobSuperStatus, STAGE_TO_SUPER_STATUS, type DealStage } from '@bitcrm/types';
import { shiftDay } from './report/report-dates';

/**
 * The Done-lines keys — the Items and services report's lines read one month
 * partition at a time instead of one Query per job.
 *
 *   GSI7PK = DONELINES#<YYYY-MM>
 *   GSI7SK = <day>#DEAL#<dealId>#<lineKey>
 *
 * On the job's `PRODUCT#` rows, on the EndIndex (GSI7): line rows carry no GSI
 * keys of their own, and the EndIndex is already a month partition sorted by
 * day — `END#<month>` (METADATA rows) and `DONELINES#<month>` (line rows)
 * never meet. No new index, no Terraform.
 *
 * `<day>` is the job's StatusScheduleIndex day — `scheduledDate`, the very
 * day the report's window read (`readReportWindow('scheduled')`) is keyed on —
 * or, for an undated job, its creation day (UTC), which the window reads the
 * undated ones by. `<lineKey>` is the line's own key (`PRODUCT#<lineKey>`), so
 * a job's lines sort in the order a Query of its partition returns them.
 *
 * Sparse: only on the lines of a live (`status = active`), Done job — the
 * window read's own two terms. Everything else the report checks (a stub,
 * the job date on the area's clock) it still checks on the job, and it keeps
 * only the lines of the jobs its window read returned.
 *
 * Written by the repositories alone: `DealProductsRepository.addProduct` (a
 * line written) and `DealsRepository.update` (a write touching
 * `DONE_LINES_INPUTS` restamps every line of the job). A derived projection:
 * `backfill:done-lines-index` reconciles it (sets AND removes) and stamps the
 * readiness row.
 */
export const DONE_LINES_PREFIX = 'DONELINES#';

/**
 * `DONELINESINDEX / STATE { readyAt, count }` — stamped by
 * `backfill:done-lines-index -- --apply` after a complete reconcile. Until it
 * exists the report keeps reading one Query per job.
 */
export const DONE_LINES_STATE_KEY = { PK: 'DONELINESINDEX', SK: 'STATE' } as const;

/** The METADATA attributes the day is computed from — a write touching one restamps the job's lines. */
export const DONE_LINES_INPUTS: ReadonlySet<string> = new Set(['status', 'superStatus', 'stage', 'scheduledDate']);

/** What a METADATA row is read for to decide its lines' keys. */
export const DONE_LINES_DEAL_PROJECTION = 'id, #status, superStatus, stage, scheduledDate, createdAt';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

type Row = Record<string, unknown>;

/** The day a job files its lines under, or nothing when its lines are not in the index. */
export function doneLinesDay(row: Row): string | undefined {
  if (row.status !== DealStatus.ACTIVE) return undefined;
  const superStatus =
    (row.superStatus as JobSuperStatus | undefined) ?? STAGE_TO_SUPER_STATUS[row.stage as DealStage] ?? JobSuperStatus.SUBMITTED;
  if (superStatus !== JobSuperStatus.DONE) return undefined;
  const scheduled = typeof row.scheduledDate === 'string' ? row.scheduledDate.slice(0, 10) : '';
  const day = scheduled || (typeof row.createdAt === 'string' ? row.createdAt.slice(0, 10) : '');
  return DAY.test(day) ? day : undefined;
}

export interface DoneLineKeys {
  GSI7PK: string;
  GSI7SK: string;
}

export function doneLineKeys(dealId: string, lineKey: string, day: string): DoneLineKeys {
  return { GSI7PK: `${DONE_LINES_PREFIX}${day.slice(0, 7)}`, GSI7SK: `${day}#DEAL#${dealId}#${lineKey}` };
}

export type DoneLinePlan = { action: 'same' } | { action: 'set'; pk: string; sk: string } | { action: 'remove' };

/** What one line row (`PK`, `SK`, its current GSI7 keys) needs, given its job's day. */
export function planDoneLine(line: Row, day: string | undefined): DoneLinePlan {
  if (day) {
    const keys = doneLineKeys(String(line.PK).slice('DEAL#'.length), String(line.SK).slice('PRODUCT#'.length), day);
    return line.GSI7PK === keys.GSI7PK && line.GSI7SK === keys.GSI7SK
      ? { action: 'same' }
      : { action: 'set', pk: keys.GSI7PK, sk: keys.GSI7SK };
  }
  return line.GSI7PK === undefined && line.GSI7SK === undefined ? { action: 'same' } : { action: 'remove' };
}

/** The UpdateCommand input that applies a plan to one line — never brings a removed line back. */
export function doneLineWrite(
  table: string,
  line: Row,
  plan: Exclude<DoneLinePlan, { action: 'same' }>,
  extraCondition?: { expression: string; names?: Record<string, string>; values?: Record<string, unknown> },
) {
  const values: Record<string, unknown> = plan.action === 'set' ? { ':pk': plan.pk, ':sk': plan.sk } : {};
  Object.assign(values, extraCondition?.values);
  return {
    TableName: table,
    Key: { PK: line.PK, SK: line.SK },
    UpdateExpression: plan.action === 'set' ? 'SET GSI7PK = :pk, GSI7SK = :sk' : 'REMOVE GSI7PK, GSI7SK',
    ConditionExpression: ['attribute_exists(PK)', extraCondition?.expression].filter(Boolean).join(' AND '),
    ...(extraCondition?.names && { ExpressionAttributeNames: extraCondition.names }),
    ...(Object.keys(values).length && { ExpressionAttributeValues: values }),
  };
}

/**
 * Which partitions, and which key range in each, a report window `from`..`to`
 * reads. Two days of margin either side: the window read itself reaches a day
 * either side of the period by visit day, and the undated ones by a creation
 * instant up to two days past it. The report keeps only the lines of the jobs
 * its window read returned, so a wider range costs a few rows, never a line.
 */
export function doneLinesReadRange(from: string, to: string): { months: string[]; lo: string; hi: string } {
  const loDay = shiftDay(from, -2);
  const hiDay = shiftDay(to, 2);
  const months: string[] = [];
  let [y, m] = loDay.slice(0, 7).split('-').map(Number);
  const last = hiDay.slice(0, 7);
  for (;;) {
    const month = `${y}-${String(m).padStart(2, '0')}`;
    months.push(month);
    if (month >= last || months.length > 240) break;
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return { months, lo: `${loDay}#`, hi: `${hiDay}#~` };
}

type Send = (command: QueryCommand | UpdateCommand) => Promise<any>;

/** Line writes at once while restamping one job. */
const RESTAMP_PARALLEL = 10;

/**
 * Every line of one job brought in line with `day` (the job's day, or nothing
 * when it is not Done): its `PRODUCT#` rows read strongly consistent, and only
 * those whose keys differ written. Answers how many were written. A line
 * deleted in between is skipped.
 */
export async function restampDoneLines(send: Send, table: string, dealId: string, day: string | undefined): Promise<number> {
  const lines: Row[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const res = await send(
      new QueryCommand({
        TableName: table,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: { ':pk': `DEAL#${dealId}`, ':sk': 'PRODUCT#' },
        ProjectionExpression: 'PK, SK, GSI7PK, GSI7SK',
        ConsistentRead: true,
        ExclusiveStartKey: startKey,
      }),
    );
    lines.push(...((res.Items ?? []) as Row[]));
    startKey = res.LastEvaluatedKey;
  } while (startKey);

  const todo = lines
    .map((line) => ({ line, plan: planDoneLine(line, day) }))
    .filter((t): t is { line: Row; plan: Exclude<DoneLinePlan, { action: 'same' }> } => t.plan.action !== 'same');
  let written = 0;
  for (let i = 0; i < todo.length; i += RESTAMP_PARALLEL) {
    const done = await Promise.all(
      todo.slice(i, i + RESTAMP_PARALLEL).map(async ({ line, plan }) => {
        try {
          await send(new UpdateCommand(doneLineWrite(table, line, plan)));
          return 1;
        } catch (err) {
          if ((err as { name?: string }).name === 'ConditionalCheckFailedException') return 0;
          throw err;
        }
      }),
    );
    written += done.reduce<number>((a, b) => a + b, 0);
  }
  return written;
}
