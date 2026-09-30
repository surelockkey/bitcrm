/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Payment, PaymentRefund } from '@bitcrm/types';
import { buildProjection, bucketRowsFor } from 'src/payments/report/payment-report.build';
import { PaymentReportProjector } from 'src/payments/report/payment-report.projector';
import { aggregatePlan, totalsFrom } from 'src/payments/report/payment-report.rules';
import { PaymentReportService } from 'src/payments/report/payment-report.service';
import { caller } from './mocks';
import { payment } from './payment-mocks';
import { FakeReportRepo } from './payment-report.fakes';

/**
 * Real September 2026 rows from the Workiz import (amounts, types and
 * instants as the generator wrote them; ids replaced). Workiz's report for
 * 1–27.09 shows Refund = 8 lines / −$927.58 — the refund lines below are
 * exactly those eight, and the five negative "credit" lines are refunds
 * Workiz allocated to credit-offline payments, which it counts under Credit
 * offline, not Refund.
 */
const REFUNDS: Array<[amount: number, type: string, at: string]> = [
  [140, 'credit', '2026-09-17T12:07:08.000Z'],
  [138.82, 'refund', '2026-09-16T12:28:34.000Z'],
  [85, 'refund', '2026-09-16T12:14:19.000Z'],
  [273.84, 'credit', '2026-09-03T12:56:33.000Z'],
  [250.62, 'refund', '2026-09-14T19:24:34.000Z'],
  [109.54, 'refund', '2026-09-16T12:22:55.000Z'],
  [153.45, 'credit', '2026-09-09T13:26:56.000Z'],
  [45, 'credit', '2026-09-11T12:58:34.000Z'],
  [167.25, 'refund', '2026-09-04T18:27:50.000Z'],
  [45.15, 'refund', '2026-09-16T17:43:44.000Z'],
  [141.47, 'credit', '2026-09-07T17:00:29.000Z'],
  [71.2, 'refund', '2026-09-14T13:18:20.000Z'],
  [60, 'refund', '2026-09-25T22:32:42.000Z'],
];

const imported = (i: number, over: Partial<Payment>): Payment =>
  payment({
    id: `wz-${i}`,
    dealId: `job-${i}`,
    invoiceId: `job-${i}`,
    source: 'office',
    takenBy: 'workiz-import',
    externalId: `workiz:payment:${i}`,
    ...over,
  });

function ledger(): Array<{ p: Payment; refunds: PaymentRefund[] }> {
  const rows: Array<{ p: Payment; refunds: PaymentRefund[] }> = [];
  REFUNDS.forEach(([amount, type, at], i) => {
    // The original payment was taken in August — outside the window.
    const p = imported(i, {
      method: 'card',
      methodDetail: type === 'credit' ? 'credit' : 'charge',
      amount: 500,
      refundedAmount: amount,
      takenAt: '2026-08-15T15:00:00.000Z',
    });
    rows.push({
      p,
      refunds: [
        {
          id: `wz-r${i}`,
          paymentId: p.id,
          invoiceId: p.invoiceId,
          amount,
          workizAmount: -amount,
          methodDetail: type,
          status: 'succeeded',
          refundedBy: 'workiz-import',
          createdAt: at,
          updatedAt: at,
        },
      ],
    });
  });
  // 6563K8: Workiz amount $1,064.44 with a $134.80 tip; we store 929.64 + 134.80.
  rows.push({
    p: imported(100, { methodDetail: 'charge', method: 'card', amount: 929.64, tipAmount: 134.8, takenAt: '2026-09-12T16:00:00.000Z' }),
    refunds: [],
  });
  // 22:14 on Aug 31 in New York — NOT in September's report.
  rows.push({ p: imported(101, { methodDetail: 'cash', method: 'cash', amount: 550, takenAt: '2026-09-01T02:14:04.000Z' }), refunds: [] });
  // 21:28 on Sep 27 in New York — IN the 1–27 window.
  rows.push({ p: imported(102, { methodDetail: 'cash', method: 'cash', amount: 250, takenAt: '2026-09-28T01:28:36.000Z' }), refunds: [] });
  // Workiz shows a failed payment at 0.
  rows.push({
    p: imported(103, { methodDetail: 'charge', method: 'card', amount: 80, status: 'failed', takenAt: '2026-09-20T16:00:00.000Z' }),
    refunds: [],
  });
  return rows;
}

describe('Payments report — Workiz parity (September 2026 rows)', () => {
  const window = { from: '2026-09-01', to: '2026-09-27' };

  async function service() {
    const repo = new FakeReportRepo();
    const projector = new PaymentReportProjector(repo as any);
    for (const { p, refunds } of ledger()) {
      repo.putPayment(p, refunds);
      await projector.projectOrThrow(p.id);
    }
    return new PaymentReportService(repo as any);
  }

  it('Refund = 8 lines / −$927.58, exactly Workiz’s figure', async () => {
    const totals = await (await service()).totals({ ...window, types: ['refund'] }, caller());
    expect(totals.count).toBe(8);
    expect(totals.amount).toBe(-927.58);
  });

  it('the allocated negatives stay under Credit offline; the tip is inside Total amount', async () => {
    const totals = await (await service()).totals(window, caller());
    expect(totals.byType.credit).toEqual({ count: 5, amount: -753.76, tips: 0 });
    expect(totals.byType.charge).toEqual({ count: 2, amount: 1064.44, tips: 134.8 });
    // Only the 21:28 Sep-27 cash is in; the Aug-31 22:14 one is not.
    expect(totals.byType.cash).toEqual({ count: 1, amount: 250, tips: 0 });
    expect(totals).toMatchObject({ count: 16, tips: 134.8 });
    expect(totals.amount).toBeCloseTo(-927.58 - 753.76 + 1064.44 + 250, 2);
  });

  it('the live projection and a rebuild from the ledger give the same totals', async () => {
    const live = await (await service()).totals(window, caller());
    const rows = ledger();
    const built = buildProjection(
      rows.map((r) => r.p),
      new Map(rows.map((r) => [r.p.id, r.refunds])),
      new Map(),
      'America/New_York',
    );
    const rebuilt = totalsFrom(bucketRowsFor(built, aggregatePlan(window.from, window.to)), {
      types: [],
      technicianIds: [],
      serviceAreaIds: [],
    });
    expect(rebuilt).toEqual(live);
  });
});
