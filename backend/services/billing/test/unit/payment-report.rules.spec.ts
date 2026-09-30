import type { PaymentRefund } from '@bitcrm/types';
import {
  aggregatePlan,
  bucketDelta,
  bucketOf,
  businessDay,
  csvHeader,
  csvLine,
  dayStartUtc,
  expandTypes,
  isUnconfirmedCheckout,
  lastDayOf,
  matchesSearch,
  monthCounts,
  parseSearch,
  paymentReportType,
  reportLines,
  totalsFrom,
  type BucketRow,
} from 'src/payments/report/payment-report.rules';
import { payment } from './payment-mocks';

const TZ = 'America/New_York';

const refund = (over: Partial<PaymentRefund> = {}): PaymentRefund => ({
  id: 'ref-1',
  paymentId: 'pay-1',
  invoiceId: 'deal-1',
  amount: 40,
  status: 'succeeded',
  refundedBy: 'u-1',
  createdAt: '2026-09-25T15:00:00.000Z',
  updatedAt: '2026-09-25T15:00:00.000Z',
  ...over,
});

describe('payment report — lines (Workiz arithmetic)', () => {
  it('a payment line carries the tip INSIDE the amount, as Workiz does', () => {
    const [line] = reportLines(
      payment({ amount: 929.64, tipAmount: 134.8, stripePaymentIntentId: 'pi_1', last4: '4242' }),
      [],
      {},
      TZ,
    );
    expect(line.amount).toBe(1064.44);
    expect(line.tip).toBe(134.8);
    expect(line.type).toBe('charge');
    expect(line.status).toBe('succeeded');
    expect(line.last4).toBe('4242');
  });

  it('a refunded payment keeps its full amount and the refund is a negative line on its own date', () => {
    const p = payment({
      amount: 100,
      refundedAmount: 40,
      stripePaymentIntentId: 'pi_1',
      takenAt: '2026-09-02T15:00:00.000Z',
    });
    const lines = reportLines(p, [refund({ stripeRefundId: 're_1' })], {}, TZ);
    expect(lines.map((l) => [l.kind, l.amount, l.day, l.type, l.description])).toEqual([
      ['payment', 100, '2026-09-02', 'charge', 'Partially refunded'],
      ['refund', -40, '2026-09-25', 'refund', undefined],
    ]);
    expect(lines.reduce((s, l) => s + l.amount, 0)).toBe(60);
  });

  it("an imported refund uses Workiz's signed amount and Workiz's type (an allocated negative credit stays 'credit')", () => {
    const p = payment({ methodDetail: 'credit', method: 'card', externalId: 'workiz:payment:1', amount: 228.2 });
    const lines = reportLines(
      p,
      [refund({ amount: 228.2, workizAmount: -228.7, methodDetail: 'credit', reference: '010010001' })],
      {},
      TZ,
    );
    expect(lines[1]).toMatchObject({ kind: 'refund', amount: -228.7, type: 'credit', reference: '010010001' });
    // An offline type has no Status tag.
    expect(lines[1].status).toBeUndefined();
    expect(lines[0].status).toBeUndefined();
  });

  it('failed and cancelled refunds are not lines', () => {
    const lines = reportLines(
      payment({ stripePaymentIntentId: 'pi_1' }),
      [refund({ status: 'failed' }), refund({ id: 'ref-2', status: 'canceled' })],
      {},
      TZ,
    );
    expect(lines).toHaveLength(1);
  });

  it('a failed payment is listed at 0 with the Failed tag', () => {
    const [line] = reportLines(
      payment({ status: 'failed', amount: 50, tipAmount: 5, stripePaymentIntentId: 'pi_1', failureReason: 'Card declined' }),
      [],
      {},
      TZ,
    );
    expect(line).toMatchObject({ amount: 0, tip: 0, status: 'failed', description: 'Card declined' });
  });

  it('a reversal (ACH return) adds a negative Dispute line on the reversal date', () => {
    const lines = reportLines(
      payment({
        method: 'bank',
        status: 'reversed',
        amount: 300,
        stripePaymentIntentId: 'pi_1',
        reversedAt: '2026-10-03T14:00:00.000Z',
        failureReason: 'The bank returned this payment',
      }),
      [],
      {},
      TZ,
    );
    expect(lines.map((l) => [l.kind, l.type, l.amount, l.day])).toEqual([
      ['payment', 'bank_transfer', 300, '2026-09-22'],
      ['reversal', 'dispute', -300, '2026-10-03'],
    ]);
  });

  it('an unconfirmed portal checkout is not a line; an imported portal payment is', () => {
    const session = payment({ status: 'pending', stripeSessionId: 'cs_1', source: 'portal', takenBy: 'client' });
    expect(isUnconfirmedCheckout(session)).toBe(true);
    expect(reportLines(session, [], {}, TZ)).toEqual([]);
    const imported = payment({ source: 'portal', takenBy: 'client', externalId: 'workiz:payment:9', methodDetail: 'charge' });
    expect(reportLines(imported, [], {}, TZ)).toHaveLength(1);
  });

  it('maps our five methods onto Workiz types', () => {
    expect(paymentReportType(payment({ method: 'card' }))).toBe('credit');
    expect(paymentReportType(payment({ method: 'card', stripePaymentIntentId: 'pi' }))).toBe('charge');
    expect(paymentReportType(payment({ method: 'bank' }))).toBe('bank_transfer');
    expect(paymentReportType(payment({ method: 'cash' }))).toBe('cash');
    expect(paymentReportType(payment({ method: 'check' }))).toBe('check');
    expect(paymentReportType(payment({ method: 'other' }))).toBe('other');
    expect(paymentReportType(payment({ method: 'other', methodDetail: 'zelle' }))).toBe('zelle');
    // A refund of an offline payment is "Refund offline".
    const lines = reportLines(payment({ method: 'cash', source: 'office', takenBy: 'u-1' }), [refund()], {}, TZ);
    expect(lines[1].type).toBe('refund_offline');
  });

  it('files the line under the payment’s own technician/area, else the job’s', () => {
    const [own] = reportLines(payment({ technicianId: 't-own', serviceAreaId: 'a-own' }), [], { technicianId: 't-job', serviceAreaId: 'a-job' }, TZ);
    expect(bucketOf(own)).toBe('credit#t-own#a-own');
    const [fallback] = reportLines(payment(), [], { technicianId: 't-job', dealNumber: 'AF6A0K' }, TZ);
    expect(bucketOf(fallback)).toBe('credit#t-job#-');
    expect(fallback.dealNumber).toBe('AF6A0K');
  });

  it('collected by: Workiz’s collector on imported rows, our user otherwise, never "client"', () => {
    const uid = '0f8fad5b-d9cb-469f-a165-70867728950e';
    expect(reportLines(payment({ takenBy: uid }), [], {}, TZ)[0].collectedById).toBe(uid);
    expect(reportLines(payment({ takenBy: 'client', stripePaymentIntentId: 'pi' }), [], {}, TZ)[0].collectedById).toBeUndefined();
    expect(
      reportLines(payment({ takenBy: 'workiz-import', collectedByName: 'Kate BPM', externalId: 'x' }), [], {}, TZ)[0]
        .collectedByName,
    ).toBe('Kate BPM');
  });
});

describe('payment report — business days (America/New_York)', () => {
  it('a payment late in the evening Eastern belongs to that Eastern day', () => {
    expect(businessDay('2026-09-01T02:14:04.000Z', TZ)).toBe('2026-08-31');
    expect(businessDay('2026-09-28T01:28:36.000Z', TZ)).toBe('2026-09-27');
    expect(businessDay('2026-09-28T04:00:00.000Z', TZ)).toBe('2026-09-28');
  });

  it('a day starts at local midnight, across both DST switches', () => {
    expect(dayStartUtc('2026-09-01', TZ)).toBe('2026-09-01T04:00:00.000Z');
    expect(dayStartUtc('2026-12-01', TZ)).toBe('2026-12-01T05:00:00.000Z');
    expect(dayStartUtc('2026-03-08', TZ)).toBe('2026-03-08T05:00:00.000Z');
    expect(dayStartUtc('2026-03-09', TZ)).toBe('2026-03-09T04:00:00.000Z');
    expect(dayStartUtc('2026-11-01', TZ)).toBe('2026-11-01T04:00:00.000Z');
    expect(dayStartUtc('2026-11-02', TZ)).toBe('2026-11-02T05:00:00.000Z');
  });

  it('knows month ends, leap years included', () => {
    expect(lastDayOf('2026-02')).toBe('2026-02-28');
    expect(lastDayOf('2028-02')).toBe('2028-02-29');
    expect(lastDayOf('2026-12')).toBe('2026-12-31');
  });
});

describe('payment report — aggregate plan', () => {
  it('whole months read month rows, partial months read day rows', () => {
    expect(aggregatePlan('2026-09-01', '2026-09-27')).toEqual([{ year: '2026', kind: 'D', from: '2026-09-01', to: '2026-09-27' }]);
    expect(aggregatePlan('2026-06-01', '2026-08-31')).toEqual([{ year: '2026', kind: 'M', from: '2026-06', to: '2026-08' }]);
    expect(aggregatePlan('2025-11-15', '2026-02-10')).toEqual([
      { year: '2025', kind: 'D', from: '2025-11-15', to: '2025-11-30' },
      { year: '2025', kind: 'M', from: '2025-12', to: '2025-12' },
      { year: '2026', kind: 'M', from: '2026-01', to: '2026-01' },
      { year: '2026', kind: 'D', from: '2026-02-01', to: '2026-02-10' },
    ]);
  });

  it('All time over nine years is one month-range per year', () => {
    const plan = aggregatePlan('2017-05-01', '2026-09-30');
    expect(plan).toHaveLength(10);
    expect(plan.every((p) => p.kind === 'M')).toBe(true);
  });
});

describe('payment report — filters and totals', () => {
  const rows: BucketRow[] = [
    { period: '2026-09-02', bucket: 'charge#t1#a1', n: 2, amountCents: 30000, tipsCents: 1000, feesCents: 900 },
    { period: '2026-09-03', bucket: 'cash#t2#a1', n: 1, amountCents: 5000, tipsCents: 0, feesCents: 0 },
    { period: '2026-08-30', bucket: 'refund#t1#-', n: 1, amountCents: -2000, tipsCents: 0, feesCents: 0 },
    { period: '2026-08-31', bucket: 'refund_offline#t2#a2', n: 1, amountCents: -500, tipsCents: 0, feesCents: 0 },
  ];

  it('Refund selects refund AND refund offline', () => {
    expect(expandTypes(['refund'])).toEqual(['refund', 'refund_offline']);
    expect(expandTypes(['cash', 'zelle'])).toEqual(['cash', 'zelle']);
  });

  it('OR inside a group, AND between groups', () => {
    const none = { types: [], technicianIds: [], serviceAreaIds: [] };
    expect(totalsFrom(rows, none)).toMatchObject({ count: 5, amount: 325, tips: 10, serviceFees: 9 });
    expect(totalsFrom(rows, { ...none, types: expandTypes(['refund']) })).toMatchObject({ count: 2, amount: -25 });
    expect(totalsFrom(rows, { ...none, technicianIds: ['t1', 't2'], serviceAreaIds: ['a1'] })).toMatchObject({
      count: 3,
      amount: 350,
    });
    const byType = totalsFrom(rows, none).byType;
    expect(byType.charge).toEqual({ count: 2, amount: 300, tips: 10 });
  });

  it('counts lines per month for the list walk', () => {
    const m = monthCounts(rows, { types: [], technicianIds: ['t2'], serviceAreaIds: [] });
    expect([...m.entries()]).toEqual([
      ['2026-09', 1],
      ['2026-08', 1],
    ]);
  });

  it('bucket deltas cancel out when nothing moved', () => {
    const c = { n: 1, amountCents: 100, tipsCents: 0, feesCents: 0 };
    expect(bucketDelta([{ key: 'k', c }], [{ key: 'k', c }]).size).toBe(0);
    const moved = bucketDelta([{ key: 'a', c }], [{ key: 'b', c }]);
    expect(moved.get('a')).toEqual({ n: -1, amountCents: -100, tipsCents: 0, feesCents: 0 });
    expect(moved.get('b')).toEqual(c);
  });

  it('search: an amount, a job number, a confirmation code or the last 4', () => {
    const [line] = reportLines(
      payment({ amount: 1000, tipAmount: 64.44, reference: 'CONF-778', last4: '4242', stripePaymentIntentId: 'pi' }),
      [],
      { dealNumber: 'AF6A0K' },
      TZ,
    );
    expect(matchesSearch(line, parseSearch('$1,064.44'))).toBe(true);
    expect(matchesSearch(line, parseSearch('af6a0k'))).toBe(true);
    expect(matchesSearch(line, parseSearch('conf-7'))).toBe(true);
    expect(matchesSearch(line, parseSearch('4242'))).toBe(true);
    expect(matchesSearch(line, parseSearch('nope'))).toBe(false);
    expect(parseSearch('  ')).toBeNull();
  });
});

describe('payment report — CSV (Workiz’s own columns)', () => {
  it('has Workiz’s header, in Workiz’s order', () => {
    expect(csvHeader()).toBe(
      'Job ID,Document,Payment type,Status,Amount,Service Fee,Net,Tips,Technician,Client name,Transaction method,' +
        'Card,Payment date,Payment time,Collected by,Description,Job type,Job status,Confirmation code',
    );
  });

  it('writes "Paid", MM/DD/YYYY on the business clock, and quotes what needs quoting', () => {
    const line = csvLine(
      {
        dealNumber: '6563K8',
        type: 'charge',
        status: 'succeeded',
        amount: 1064.44,
        serviceFee: 31.2,
        net: 1033.24,
        tip: 134.8,
        technicianName: 'Tom Tech',
        clientName: 'Doe, Jane',
        transactionMethod: 'Card reader',
        card: 'XXXX4242',
        at: '2026-09-02T01:30:00.000Z',
        collectedByName: 'Kate',
        description: 'Transaction was approved',
        jobTypeName: 'Lockout',
        jobStatus: 'Done',
        confirmationCode: '0099',
      },
      TZ,
    );
    expect(line).toBe(
      '6563K8,Job 6563K8,Credit charge,Paid,1064.44,31.20,1033.24,134.80,Tom Tech,"Doe, Jane",Card reader,' +
        'XXXX4242,09/01/2026,9:30 PM,Kate,Transaction was approved,Lockout,Done,0099',
    );
    expect(csvLine({ type: 'refund', amount: -40, tip: 0, at: '2026-09-25T15:00:00.000Z' }, TZ)).toContain(
      ',Refund,Refunded,-40.00,',
    );
  });
});
