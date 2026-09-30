import { Injectable } from '@nestjs/common';
import {
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
  type QueryCommandInput,
} from '@aws-sdk/lib-dynamodb';
import { DynamoDbService } from '@bitcrm/shared';
import type { Payment, PaymentRefund } from '@bitcrm/types';
import {
  BILLING_TABLE,
  METADATA_SK,
  PAYMENT_REPORT_POINTER_SK,
  PAYREPORT_INDEX_PK,
  PAYREPORT_INDEX_SK,
  REFUND_SK_PREFIX,
  payaggDaySk,
  payaggMonthSk,
  payaggPk,
  paylinePk,
  paylineSk,
  paymentPk,
  stripKeys,
} from '../../common/constants/dynamo.constants';
import { isConditionalCheckFailed, isTransactionCanceled } from '../../common/dynamo-errors';
import type { BucketRow, Contribution, DayBuckets, ReportLine } from './payment-report.rules';

/** The projector lost a race (another projection of the same payment, or a bucket being written) — re-read and retry. */
export class ReportProjectionConflictError extends Error {
  constructor() {
    super('Payment report projection conflict');
    this.name = 'ReportProjectionConflictError';
  }
}

/** One stored line as the pointer remembers it: where it lives and what it added. */
export interface PointerLine extends Contribution {
  pk: string;
  sk: string;
  /** `<day>#<bucket>` */
  key: string;
}

export interface ReportPointer {
  lines: PointerLine[];
  rev: number;
}

/** The whole `PAYMENT#<id>` partition, read strongly consistent: the row, its refunds, its report pointer. */
export interface PaymentPartition {
  payment: Payment | null;
  refunds: PaymentRefund[];
  pointer: ReportPointer | null;
}

export interface LineWalkCursor {
  /** Months still to walk, the current one first. */
  ms: string[];
  /** Where to resume inside `ms[0]`. */
  k?: { PK: string; SK: string };
}

export interface LineFilterExpr {
  types: string[];
  technicianIds: string[];
  serviceAreaIds: string[];
}

/** DynamoDB's own ceiling on one TransactWrite. */
const MAX_TRANSACT_ITEMS = 100;

/**
 * Storage of the Payments report — a projection of the ledger, never the
 * source of truth (key layout: `dynamo.constants.ts`, "payments report").
 */
@Injectable()
export class PaymentReportRepository {
  constructor(private readonly db: DynamoDbService) {}

  // ------------------------------------------------------------ projection

  async readPaymentPartition(paymentId: string): Promise<PaymentPartition> {
    const out: PaymentPartition = { payment: null, refunds: [], pointer: null };
    let ExclusiveStartKey: Record<string, unknown> | undefined;
    do {
      const res = await this.db.client.send(
        new QueryCommand({
          TableName: BILLING_TABLE,
          KeyConditionExpression: 'PK = :pk',
          ExpressionAttributeValues: { ':pk': paymentPk(paymentId) },
          ConsistentRead: true,
          ExclusiveStartKey,
        }),
      );
      for (const item of res.Items ?? []) {
        const sk = item.SK as string;
        if (sk === METADATA_SK) out.payment = stripKeys<Payment>(item);
        else if (sk.startsWith(REFUND_SK_PREFIX)) out.refunds.push(stripKeys<PaymentRefund>(item)!);
        else if (sk === PAYMENT_REPORT_POINTER_SK) {
          out.pointer = { lines: (item.lines as PointerLine[]) ?? [], rev: Number(item.rev) || 0 };
        }
      }
      ExclusiveStartKey = res.LastEvaluatedKey;
    } while (ExclusiveStartKey);
    return out;
  }

  /**
   * Moves one payment's report state from `prev` to `lines` in ONE
   * transaction: the pointer (guarded by its `rev`, so two projections of the
   * same payment serialise), the line rows, and the bucket deltas. Throws
   * `ReportProjectionConflictError` when someone else got there first.
   */
  async commit(
    paymentId: string,
    prev: ReportPointer | null,
    lines: Array<{ line: ReportLine; pointer: PointerLine }>,
    deltas: DayBuckets,
  ): Promise<void> {
    const items: NonNullable<ConstructorParameters<typeof TransactWriteCommand>[0]['TransactItems']> = [];
    const pointerKey = { PK: paymentPk(paymentId), SK: PAYMENT_REPORT_POINTER_SK };

    if (lines.length) {
      items.push({
        Put: {
          TableName: BILLING_TABLE,
          Item: {
            ...pointerKey,
            entityType: 'payment_report_pointer',
            paymentId,
            lines: lines.map((l) => l.pointer),
            rev: (prev?.rev ?? 0) + 1,
            updatedAt: new Date().toISOString(),
          },
          ...(prev
            ? {
                ConditionExpression: '#rev = :rev',
                ExpressionAttributeNames: { '#rev': 'rev' },
                ExpressionAttributeValues: { ':rev': prev.rev },
              }
            : { ConditionExpression: 'attribute_not_exists(PK)' }),
        },
      });
    } else if (prev) {
      items.push({
        Delete: {
          TableName: BILLING_TABLE,
          Key: pointerKey,
          ConditionExpression: '#rev = :rev',
          ExpressionAttributeNames: { '#rev': 'rev' },
          ExpressionAttributeValues: { ':rev': prev.rev },
        },
      });
    }

    const keep = new Set(lines.map((l) => `${l.pointer.pk}|${l.pointer.sk}`));
    for (const old of prev?.lines ?? []) {
      if (!keep.has(`${old.pk}|${old.sk}`)) {
        items.push({ Delete: { TableName: BILLING_TABLE, Key: { PK: old.pk, SK: old.sk } } });
      }
    }
    for (const { line, pointer } of lines) {
      items.push({ Put: { TableName: BILLING_TABLE, Item: lineItem(line, pointer) } });
    }
    for (const u of bucketUpdates(deltas)) items.push({ Update: u });

    if (items.length === 0) return;
    if (items.length > MAX_TRANSACT_ITEMS) {
      throw new Error(`payment ${paymentId}: ${items.length} report writes exceed one transaction`);
    }
    try {
      await this.db.client.send(new TransactWriteCommand({ TransactItems: items }));
    } catch (err) {
      if (isTransactionCanceled(err) || isConditionalCheckFailed(err)) throw new ReportProjectionConflictError();
      throw err;
    }
  }

  // ---------------------------------------------------------------- index

  async getIndex(): Promise<{ firstMonth?: string; lastMonth?: string }> {
    const res = await this.db.client.send(
      new GetCommand({ TableName: BILLING_TABLE, Key: { PK: PAYREPORT_INDEX_PK, SK: PAYREPORT_INDEX_SK } }),
    );
    return {
      ...(res.Item?.firstMonth && { firstMonth: res.Item.firstMonth as string }),
      ...(res.Item?.lastMonth && { lastMonth: res.Item.lastMonth as string }),
    };
  }

  /** Widens "All time" to include `month`. Each bound only ever moves outwards. */
  async widenIndex(month: string): Promise<void> {
    for (const [attr, cmp] of [
      ['firstMonth', '>'],
      ['lastMonth', '<'],
    ] as const) {
      try {
        await this.db.client.send(
          new UpdateCommand({
            TableName: BILLING_TABLE,
            Key: { PK: PAYREPORT_INDEX_PK, SK: PAYREPORT_INDEX_SK },
            UpdateExpression: 'SET #a = :m, entityType = :et',
            ConditionExpression: `attribute_not_exists(#a) OR #a ${cmp} :m`,
            ExpressionAttributeNames: { '#a': attr },
            ExpressionAttributeValues: { ':m': month, ':et': 'payment_report_index' },
          }),
        );
      } catch (err) {
        if (!isConditionalCheckFailed(err)) throw err;
      }
    }
  }

  // --------------------------------------------------------------- reads

  /** Bucket rows for an aggregate plan (see `aggregatePlan`), all queries in parallel. */
  async readBuckets(plan: Array<{ year: string; kind: 'M' | 'D'; from: string; to: string }>): Promise<BucketRow[]> {
    const parts = await Promise.all(
      plan.map(async (p) => {
        const rows: BucketRow[] = [];
        let ExclusiveStartKey: Record<string, unknown> | undefined;
        do {
          const res = await this.db.client.send(
            new QueryCommand({
              TableName: BILLING_TABLE,
              KeyConditionExpression: 'PK = :pk AND SK BETWEEN :a AND :b',
              ExpressionAttributeValues: {
                ':pk': payaggPk(p.year),
                ':a': `${p.kind}#${p.from}`,
                ':b': `${p.kind}#${p.to}#~`,
              },
              ProjectionExpression: 'SK, n, amountCents, tipsCents, feesCents',
              ExclusiveStartKey,
            }),
          );
          for (const item of res.Items ?? []) {
            // SK = <kind>#<period>#<type>#<tech>#<area>
            const [, period, ...bucket] = (item.SK as string).split('#');
            rows.push({
              period,
              bucket: bucket.join('#'),
              n: Number(item.n) || 0,
              amountCents: Number(item.amountCents) || 0,
              tipsCents: Number(item.tipsCents) || 0,
              feesCents: Number(item.feesCents) || 0,
            });
          }
          ExclusiveStartKey = res.LastEvaluatedKey;
        } while (ExclusiveStartKey);
        return rows;
      }),
    );
    return parts.flat();
  }

  /**
   * One step of the line walk: lines of the months in `cursor.ms`, in payment
   * date order, between two instants, narrowed by the filter — until `take`
   * accepts `want` lines or the month list runs out. `accept` is the in-memory
   * part of the filter (the search box); DynamoDB applies the rest.
   *
   * Returns the next cursor pointing just past the last line TAKEN, so a page
   * never skips a line it read but did not return.
   */
  async walkLines(opts: {
    cursor: LineWalkCursor;
    fromIso: string;
    toIso: string;
    dir: 'asc' | 'desc';
    filter: LineFilterExpr;
    want: number;
    accept?: (l: ReportLine) => boolean;
    maxRounds?: number;
  }): Promise<{ lines: ReportLine[]; next?: LineWalkCursor; exhausted: boolean }> {
    const lines: ReportLine[] = [];
    const ms = [...opts.cursor.ms];
    let startKey: Record<string, unknown> | undefined = opts.cursor.k;
    const filter = filterExpression(opts.filter);
    let rounds = 0;
    const maxRounds = opts.maxRounds ?? 60;

    while (ms.length && lines.length < opts.want) {
      if (rounds++ >= maxRounds) return { lines, next: { ms, ...(startKey && { k: startKey as LineWalkCursor['k'] }) }, exhausted: false };
      const input: QueryCommandInput = {
        TableName: BILLING_TABLE,
        KeyConditionExpression: 'PK = :pk AND SK BETWEEN :a AND :b',
        ExpressionAttributeValues: {
          ':pk': paylinePk(ms[0]),
          ':a': opts.fromIso,
          ':b': opts.toIso,
          ...filter.values,
        },
        ...(filter.names && { ExpressionAttributeNames: filter.names }),
        ...(filter.expression && { FilterExpression: filter.expression }),
        ScanIndexForward: opts.dir === 'asc',
        Limit: 500,
        ExclusiveStartKey: startKey,
      };
      const res = await this.db.client.send(new QueryCommand(input));
      const items = res.Items ?? [];
      for (let i = 0; i < items.length; i++) {
        const line = toLine(items[i]);
        if (opts.accept && !opts.accept(line)) continue;
        lines.push(line);
        if (lines.length >= opts.want) {
          const more = i < items.length - 1 || !!res.LastEvaluatedKey;
          if (more) return { lines, next: { ms, k: { PK: items[i].PK as string, SK: items[i].SK as string } }, exhausted: false };
          ms.shift();
          return { lines, ...(ms.length && { next: { ms } }), exhausted: ms.length === 0 };
        }
      }
      startKey = res.LastEvaluatedKey;
      if (!startKey) ms.shift();
    }
    return { lines, ...(ms.length && { next: { ms, ...(startKey && { k: startKey as LineWalkCursor['k'] }) } }), exhausted: ms.length === 0 };
  }
}

// ------------------------------------------------------------------ helpers

function lineItem(line: ReportLine, pointer: PointerLine): Record<string, unknown> {
  return { PK: pointer.pk, SK: pointer.sk, entityType: 'payment_report_line', ...line };
}

function toLine(item: Record<string, unknown>): ReportLine {
  const copy = { ...item };
  delete copy.PK;
  delete copy.SK;
  delete copy.entityType;
  return copy as unknown as ReportLine;
}

/** The two bucket rows (day + month) every `<day>#<bucket>` delta moves — month deltas merged first. */
export function bucketUpdates(deltas: DayBuckets): Array<{
  TableName: string;
  Key: { PK: string; SK: string };
  UpdateExpression: string;
  ExpressionAttributeNames: Record<string, string>;
  ExpressionAttributeValues: Record<string, unknown>;
}> {
  const months = new Map<string, Contribution>();
  const out: ReturnType<typeof bucketUpdates> = [];
  const update = (pk: string, sk: string, period: string, bucket: string, c: Contribution) => ({
    TableName: BILLING_TABLE,
    Key: { PK: pk, SK: sk },
    UpdateExpression: 'ADD #n :n, #a :a, #t :t, #f :f SET #et = :et, #p = :p, #b = :b',
    ExpressionAttributeNames: {
      '#n': 'n',
      '#a': 'amountCents',
      '#t': 'tipsCents',
      '#f': 'feesCents',
      '#et': 'entityType',
      '#p': 'period',
      '#b': 'bucket',
    },
    ExpressionAttributeValues: {
      ':n': c.n,
      ':a': c.amountCents,
      ':t': c.tipsCents,
      ':f': c.feesCents,
      ':et': 'payment_report_bucket',
      ':p': period,
      ':b': bucket,
    },
  });
  for (const [key, c] of deltas) {
    const i = key.indexOf('#');
    const day = key.slice(0, i);
    const bucket = key.slice(i + 1);
    out.push(update(payaggPk(day.slice(0, 4)), payaggDaySk(day, bucket), day, bucket, c));
    const mKey = `${day.slice(0, 7)}#${bucket}`;
    const cur = months.get(mKey) ?? { n: 0, amountCents: 0, tipsCents: 0, feesCents: 0 };
    months.set(mKey, {
      n: cur.n + c.n,
      amountCents: cur.amountCents + c.amountCents,
      tipsCents: cur.tipsCents + c.tipsCents,
      feesCents: cur.feesCents + c.feesCents,
    });
  }
  for (const [key, c] of months) {
    if (c.n === 0 && c.amountCents === 0 && c.tipsCents === 0 && c.feesCents === 0) continue;
    const i = key.indexOf('#');
    const month = key.slice(0, i);
    const bucket = key.slice(i + 1);
    out.push(update(payaggPk(month.slice(0, 4)), payaggMonthSk(month, bucket), month, bucket, c));
  }
  return out;
}

/** The pointer entry of one line: where its row lives and what it added to which bucket. */
export function pointerFor(line: ReportLine, key: string, c: Contribution): PointerLine {
  return { pk: paylinePk(line.day.slice(0, 7)), sk: paylineSk(line.at, line.lineId), key, ...c };
}

function filterExpression(f: LineFilterExpr): {
  expression?: string;
  names?: Record<string, string>;
  values: Record<string, unknown>;
} {
  const parts: string[] = [];
  const names: Record<string, string> = {};
  const values: Record<string, unknown> = {};
  const group = (attr: string, alias: string, list: string[]) => {
    if (!list.length) return;
    names[`#${alias}`] = attr;
    const keys = list.map((v, i) => {
      values[`:${alias}${i}`] = v;
      return `:${alias}${i}`;
    });
    parts.push(`#${alias} IN (${keys.join(', ')})`);
  };
  group('type', 'ty', f.types);
  group('technicianId', 'te', f.technicianIds);
  group('serviceAreaId', 'sa', f.serviceAreaIds);
  return parts.length ? { expression: parts.join(' AND '), names, values } : { values };
}
