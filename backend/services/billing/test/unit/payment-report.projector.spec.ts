/* eslint-disable @typescript-eslint/no-explicit-any */
import type { PaymentRefund } from '@bitcrm/types';
import { buildProjection } from 'src/payments/report/payment-report.build';
import { PaymentReportProjector } from 'src/payments/report/payment-report.projector';
import { billingView, mockDealClient } from './mocks';
import { payment } from './payment-mocks';
import { FakeReportRepo } from './payment-report.fakes';

const refund = (over: Partial<PaymentRefund> = {}): PaymentRefund => ({
  id: 'ref-1',
  paymentId: 'pay-1',
  invoiceId: 'deal-1',
  amount: 40,
  status: 'succeeded',
  refundedBy: 'u-1',
  createdAt: '2026-10-02T15:00:00.000Z',
  updatedAt: '2026-10-02T15:00:00.000Z',
  ...over,
});

function build() {
  const repo = new FakeReportRepo();
  const deal = mockDealClient();
  deal.getBillingView.mockImplementation(async () =>
    billingView({ assignedTechIds: ['tech-job'], serviceAreaId: 'area-job', dealNumber: 'K4T9ZW' } as any),
  );
  const projector = new PaymentReportProjector(repo as any, deal as any);
  return { repo, deal, projector };
}

/** What the rebuild would write for the fake's ledger — the incremental result must equal it. */
function rebuilt(repo: FakeReportRepo) {
  const dims = new Map([['deal-1', { technicianId: 'tech-job', serviceAreaId: 'area-job', dealNumber: 'K4T9ZW' }]]);
  const built = buildProjection(repo.payments.values(), repo.refunds, dims, 'America/New_York');
  return new Map([...built.buckets.entries()].map(([k, b]) => [k, b.c]));
}

describe('PaymentReportProjector', () => {
  it('projects a new payment: one line, a day bucket and a month bucket', async () => {
    const { repo, projector } = build();
    repo.putPayment(payment({ id: 'pay-1', amount: 100, tipAmount: 15, stripePaymentIntentId: 'pi_1' }));
    await projector.projectOrThrow('pay-1');

    expect([...repo.lines.values()].map((l) => [l.amount, l.tip, l.type, l.technicianId, l.dealNumber])).toEqual([
      [115, 15, 'charge', 'tech-job', 'K4T9ZW'],
    ]);
    expect(repo.liveBuckets()).toEqual(
      new Map([
        ['PAYAGG#2026|D#2026-09-22#charge#tech-job#area-job', { n: 1, amountCents: 11500, tipsCents: 1500, feesCents: 0 }],
        ['PAYAGG#2026|M#2026-09#charge#tech-job#area-job', { n: 1, amountCents: 11500, tipsCents: 1500, feesCents: 0 }],
      ]),
    );
    expect(repo.index).toEqual({ firstMonth: '2026-09', lastMonth: '2026-09' });
  });

  it('projecting twice changes nothing the second time', async () => {
    const { repo, projector } = build();
    repo.putPayment(payment({ id: 'pay-1' }));
    await projector.projectOrThrow('pay-1');
    const before = repo.liveBuckets();
    await projector.projectOrThrow('pay-1');
    expect(repo.liveBuckets()).toEqual(before);
    expect(repo.pointers.get('pay-1')!.rev).toBe(2);
  });

  it('a history of writes ends exactly where a rebuild from the ledger would', async () => {
    const { repo, projector } = build();
    // Three payments across two months, one of them the job's own tech's.
    repo.putPayment(payment({ id: 'pay-1', amount: 100, stripePaymentIntentId: 'pi_1', takenAt: '2026-09-02T15:00:00.000Z' }));
    repo.putPayment(payment({ id: 'pay-2', method: 'cash', source: 'office', takenBy: 'u-1', amount: 50, technicianId: 't-own', takenAt: '2026-09-30T23:30:00.000Z' }));
    repo.putPayment(payment({ id: 'pay-3', method: 'check', source: 'office', takenBy: 'u-1', amount: 70, takenAt: '2026-10-01T12:00:00.000Z' }));
    for (const id of ['pay-1', 'pay-2', 'pay-3']) await projector.projectOrThrow(id);

    // A partial refund a month later, then a second one.
    repo.putPayment(payment({ id: 'pay-1', amount: 100, refundedAmount: 40, stripePaymentIntentId: 'pi_1', takenAt: '2026-09-02T15:00:00.000Z' }), [refund()]);
    await projector.projectOrThrow('pay-1');
    repo.putPayment(
      payment({ id: 'pay-1', amount: 100, refundedAmount: 100, status: 'refunded', stripePaymentIntentId: 'pi_1', takenAt: '2026-09-02T15:00:00.000Z' }),
      [refund(), refund({ id: 'ref-2', amount: 60, createdAt: '2026-10-05T15:00:00.000Z' })],
    );
    await projector.projectOrThrow('pay-1');
    // A mis-keyed cheque is deleted.
    repo.deletePayment('pay-3');
    await projector.projectOrThrow('pay-3');

    expect(repo.liveBuckets()).toEqual(rebuilt(repo));
    expect(repo.pointers.has('pay-3')).toBe(false);
    // pay-1 + its two refunds, pay-2; nothing of pay-3.
    expect([...repo.lines.values()].map((l) => [l.lineId, l.amount]).sort()).toEqual([
      ['pay-1', 100],
      ['pay-2', 50],
      ['ref-1', -40],
      ['ref-2', -60],
    ]);
  });

  it('a lost race is re-run against the fresh state', async () => {
    const { repo, projector } = build();
    repo.putPayment(payment({ id: 'pay-1' }));
    repo.conflictsLeft = 2;
    await projector.projectOrThrow('pay-1');
    expect(repo.commits).toBe(1);
    expect(repo.readPaymentPartition).toHaveBeenCalledTimes(3);
  });

  it('never throws from project(): a report that lags must not fail a payment', async () => {
    const { repo, projector } = build();
    repo.putPayment(payment({ id: 'pay-1' }));
    repo.conflictsLeft = 99;
    await expect(projector.project('pay-1')).resolves.toBeUndefined();
    await expect(projector.projectOrThrow('pay-1')).rejects.toThrow('conflict');
  });

  it('with deal-service down the line still counts, just without job dimensions', async () => {
    const { repo, deal, projector } = build();
    deal.getBillingView.mockRejectedValue(new Error('down'));
    repo.putPayment(payment({ id: 'pay-1' }));
    await projector.projectOrThrow('pay-1');
    expect([...repo.liveBuckets().keys()]).toEqual([
      'PAYAGG#2026|D#2026-09-22#credit#-#-',
      'PAYAGG#2026|M#2026-09#credit#-#-',
    ]);
  });

  it('an unconfirmed portal checkout never reaches the report', async () => {
    const { repo, projector } = build();
    repo.putPayment(payment({ id: 'pay-1', status: 'pending', stripeSessionId: 'cs_1' }));
    await projector.projectOrThrow('pay-1');
    expect(repo.lines.size).toBe(0);
    expect(repo.commits).toBe(0);
  });
});
