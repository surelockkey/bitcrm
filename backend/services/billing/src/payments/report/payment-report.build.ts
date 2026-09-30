import type { Payment, PaymentRefund } from '@bitcrm/types';
import {
  payaggDaySk,
  payaggMonthSk,
  payaggPk,
} from '../../common/constants/dynamo.constants';
import { pointerFor, type PointerLine } from './payment-report.repository';
import {
  PAYMENT_REPORT_TZ,
  addInto,
  bucketOf,
  contributionOf,
  reportLines,
  type BucketRow,
  type Contribution,
  type DayBuckets,
  type LineDims,
  type ReportLine,
} from './payment-report.rules';

/** The whole report, computed from the ledger in memory — what `rebuild:payment-report` writes. */
export interface BuiltProjection {
  lines: Array<{ line: ReportLine; pointer: PointerLine }>;
  pointers: Map<string, PointerLine[]>;
  /** `D#<day>#<bucket>` and `M#<month>#<bucket>` → counters, per year partition. */
  buckets: Map<string, { pk: string; sk: string; period: string; bucket: string; c: Contribution }>;
  firstMonth?: string;
  lastMonth?: string;
}

/**
 * Every line and bucket the ledger implies. The same functions the live
 * projector uses (`reportLines`, `bucketOf`, `contributionOf`), so a rebuilt
 * report and an incrementally maintained one agree to the cent.
 */
export function buildProjection(
  payments: Iterable<Payment>,
  refundsByPayment: Map<string, PaymentRefund[]>,
  dimsByDeal: Map<string, LineDims> = new Map(),
  tz: string = PAYMENT_REPORT_TZ,
): BuiltProjection {
  const out: BuiltProjection = { lines: [], pointers: new Map(), buckets: new Map() };
  const days: DayBuckets = new Map();
  for (const p of payments) {
    const lines = reportLines(p, refundsByPayment.get(p.id) ?? [], dimsByDeal.get(p.dealId) ?? {}, tz);
    if (lines.length === 0) continue;
    const pointers: PointerLine[] = [];
    for (const line of lines) {
      const key = `${line.day}#${bucketOf(line)}`;
      const c = contributionOf(line);
      const pointer = pointerFor(line, key, c);
      out.lines.push({ line, pointer });
      pointers.push(pointer);
      addInto(days, key, c);
      const month = line.day.slice(0, 7);
      if (!out.firstMonth || month < out.firstMonth) out.firstMonth = month;
      if (!out.lastMonth || month > out.lastMonth) out.lastMonth = month;
    }
    out.pointers.set(p.id, pointers);
  }
  const months: DayBuckets = new Map();
  for (const [key, c] of days) {
    const i = key.indexOf('#');
    const day = key.slice(0, i);
    const bucket = key.slice(i + 1);
    out.buckets.set(`${payaggPk(day.slice(0, 4))}|${payaggDaySk(day, bucket)}`, {
      pk: payaggPk(day.slice(0, 4)),
      sk: payaggDaySk(day, bucket),
      period: day,
      bucket,
      c,
    });
    addInto(months, `${day.slice(0, 7)}#${bucket}`, c);
  }
  for (const [key, c] of months) {
    const i = key.indexOf('#');
    const month = key.slice(0, i);
    const bucket = key.slice(i + 1);
    out.buckets.set(`${payaggPk(month.slice(0, 4))}|${payaggMonthSk(month, bucket)}`, {
      pk: payaggPk(month.slice(0, 4)),
      sk: payaggMonthSk(month, bucket),
      period: month,
      bucket,
      c,
    });
  }
  return out;
}

/**
 * The bucket rows an aggregate plan would read from a built projection —
 * lets a test or the offline verification run the endpoint's own totals
 * arithmetic (`aggregatePlan` + `totalsFrom`) with no DynamoDB.
 */
export function bucketRowsFor(
  built: BuiltProjection,
  plan: Array<{ year: string; kind: 'M' | 'D'; from: string; to: string }>,
): BucketRow[] {
  const rows: BucketRow[] = [];
  for (const b of built.buckets.values()) {
    const kind = b.sk.slice(0, 1) as 'M' | 'D';
    const year = b.pk.slice('PAYAGG#'.length);
    if (!plan.some((p) => p.kind === kind && p.year === year && b.period >= p.from && b.period <= p.to)) continue;
    rows.push({ bucket: b.bucket, period: b.period, ...b.c });
  }
  return rows;
}
