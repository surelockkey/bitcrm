/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Payment, PaymentRefund } from '@bitcrm/types';
import {
  ReportProjectionConflictError,
  bucketUpdates,
  type LineWalkCursor,
  type PointerLine,
  type ReportPointer,
} from 'src/payments/report/payment-report.repository';
import {
  businessDay,
  type BucketRow,
  type Contribution,
  type DayBuckets,
  type ReportLine,
} from 'src/payments/report/payment-report.rules';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

/**
 * An in-memory PaymentReportRepository with the real semantics that matter:
 * the pointer's rev guard, line puts/deletes, and bucket ADDs keyed exactly
 * as `bucketUpdates` keys them for DynamoDB.
 */
export class FakeReportRepo {
  payments = new Map<string, Payment>();
  refunds = new Map<string, PaymentRefund[]>();
  pointers = new Map<string, ReportPointer>();
  /** `<pk>|<sk>` → line */
  lines = new Map<string, ReportLine>();
  /** `<pk>|<sk>` → counters */
  buckets = new Map<string, Contribution & { period: string; bucket: string }>();
  index: { firstMonth?: string; lastMonth?: string } = {};
  conflictsLeft = 0;
  commits = 0;

  putPayment(p: Payment, refunds: PaymentRefund[] = []): void {
    this.payments.set(p.id, clone(p));
    this.refunds.set(p.id, clone(refunds));
  }

  deletePayment(id: string): void {
    this.payments.delete(id);
    this.refunds.delete(id);
  }

  readPaymentPartition = jest.fn(async (id: string) => ({
    payment: this.payments.has(id) ? clone(this.payments.get(id)!) : null,
    refunds: clone(this.refunds.get(id) ?? []),
    pointer: this.pointers.has(id) ? clone(this.pointers.get(id)!) : null,
  }));

  commit = jest.fn(
    async (
      id: string,
      prev: ReportPointer | null,
      lines: Array<{ line: ReportLine; pointer: PointerLine }>,
      deltas: DayBuckets,
    ) => {
      if (this.conflictsLeft > 0) {
        this.conflictsLeft -= 1;
        throw new ReportProjectionConflictError();
      }
      const stored = this.pointers.get(id) ?? null;
      if ((stored?.rev ?? null) !== (prev?.rev ?? null)) throw new ReportProjectionConflictError();
      this.commits += 1;
      const keep = new Set(lines.map((l) => `${l.pointer.pk}|${l.pointer.sk}`));
      for (const old of prev?.lines ?? []) if (!keep.has(`${old.pk}|${old.sk}`)) this.lines.delete(`${old.pk}|${old.sk}`);
      for (const l of lines) this.lines.set(`${l.pointer.pk}|${l.pointer.sk}`, clone(l.line));
      if (lines.length) this.pointers.set(id, { lines: lines.map((l) => l.pointer), rev: (prev?.rev ?? 0) + 1 });
      else this.pointers.delete(id);
      for (const u of bucketUpdates(deltas)) {
        const key = `${u.Key.PK}|${u.Key.SK}`;
        const v = u.ExpressionAttributeValues as any;
        const cur = this.buckets.get(key) ?? { n: 0, amountCents: 0, tipsCents: 0, feesCents: 0, period: v[':p'], bucket: v[':b'] };
        this.buckets.set(key, {
          n: cur.n + v[':n'],
          amountCents: cur.amountCents + v[':a'],
          tipsCents: cur.tipsCents + v[':t'],
          feesCents: cur.feesCents + v[':f'],
          period: v[':p'],
          bucket: v[':b'],
        });
      }
    },
  );

  widenIndex = jest.fn(async (month: string) => {
    if (!this.index.firstMonth || month < this.index.firstMonth) this.index.firstMonth = month;
    if (!this.index.lastMonth || month > this.index.lastMonth) this.index.lastMonth = month;
  });

  getIndex = jest.fn(async () => ({ ...this.index }));

  /** Non-zero buckets, as `<pk>|<sk>` → counters (what a rebuild would write). */
  liveBuckets(): Map<string, Contribution> {
    const out = new Map<string, Contribution>();
    for (const [k, b] of this.buckets) {
      if (b.n === 0 && b.amountCents === 0 && b.tipsCents === 0 && b.feesCents === 0) continue;
      out.set(k, { n: b.n, amountCents: b.amountCents, tipsCents: b.tipsCents, feesCents: b.feesCents });
    }
    return out;
  }

  readBuckets = jest.fn(async (plan: Array<{ year: string; kind: 'M' | 'D'; from: string; to: string }>) => {
    const rows: BucketRow[] = [];
    for (const [key, b] of this.buckets) {
      const [pk, sk] = key.split('|');
      const kind = sk.slice(0, 1) as 'M' | 'D';
      const year = pk.slice('PAYAGG#'.length);
      if (!plan.some((p) => p.kind === kind && p.year === year && b.period >= p.from && b.period <= p.to)) continue;
      rows.push({ period: b.period, bucket: b.bucket, n: b.n, amountCents: b.amountCents, tipsCents: b.tipsCents, feesCents: b.feesCents });
    }
    return rows;
  });

  /** The line walk over the in-memory lines, with the repository's cursor contract. */
  walkLines = jest.fn(
    async (opts: {
      cursor: LineWalkCursor;
      fromIso: string;
      toIso: string;
      dir: 'asc' | 'desc';
      filter: { types: string[]; technicianIds: string[]; serviceAreaIds: string[] };
      want: number;
      accept?: (l: ReportLine) => boolean;
    }) => {
      const ms = [...opts.cursor.ms];
      const out: ReportLine[] = [];
      let after = opts.cursor.k?.SK;
      while (ms.length && out.length < opts.want) {
        const month = ms[0];
        const inMonth = [...this.lines.entries()]
          .filter(([k]) => k.startsWith(`PAYLINE#${month}|`))
          .map(([k, l]) => ({ sk: k.split('|')[1], l }))
          .filter(({ sk }) => sk >= opts.fromIso && sk <= opts.toIso)
          .sort((a, b) => (opts.dir === 'asc' ? a.sk.localeCompare(b.sk) : b.sk.localeCompare(a.sk)))
          .filter(({ sk }) => after === undefined || (opts.dir === 'asc' ? sk > after : sk < after))
          .filter(({ l }) => {
            const f = opts.filter;
            if (f.types.length && !f.types.includes(l.type)) return false;
            if (f.technicianIds.length && !f.technicianIds.includes(l.technicianId ?? '')) return false;
            if (f.serviceAreaIds.length && !f.serviceAreaIds.includes(l.serviceAreaId ?? '')) return false;
            return !opts.accept || opts.accept(l);
          });
        for (let i = 0; i < inMonth.length; i++) {
          out.push(inMonth[i].l);
          if (out.length >= opts.want && i < inMonth.length - 1) {
            return { lines: out, next: { ms, k: { PK: `PAYLINE#${month}`, SK: inMonth[i].sk } }, exhausted: false };
          }
          if (out.length >= opts.want) break;
        }
        ms.shift();
        after = undefined;
      }
      return { lines: out, ...(ms.length && { next: { ms } }), exhausted: ms.length === 0 };
    },
  );
}

/** A day on the business clock, for readable assertions. */
export const dayOf = (iso: string) => businessDay(iso, 'America/New_York');
