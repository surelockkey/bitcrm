/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  PaymentReportRepository,
  ReportProjectionConflictError,
  pointerFor,
} from 'src/payments/report/payment-report.repository';
import { bucketOf, contributionOf, reportLines } from 'src/payments/report/payment-report.rules';
import { payment } from './payment-mocks';

function repoWith(send: jest.Mock) {
  return new PaymentReportRepository({ client: { send } } as any);
}

const lineOf = (over: Parameters<typeof payment>[0] = {}) => {
  const [line] = reportLines(payment({ stripePaymentIntentId: 'pi', ...over }), [], {}, 'America/New_York');
  const key = `${line.day}#${bucketOf(line)}`;
  return { line, pointer: pointerFor(line, key, contributionOf(line)) };
};

describe('PaymentReportRepository.commit', () => {
  it('writes pointer, line and BOTH bucket rows in one transaction; a first write needs no pointer yet', async () => {
    const send = jest.fn(async () => ({}));
    const l = lineOf({ amount: 100 });
    await repoWith(send).commit(
      'pay-1',
      null,
      [l],
      new Map([[l.pointer.key, { n: 1, amountCents: 10000, tipsCents: 0, feesCents: 0 }]]),
    );
    const items = (send.mock.calls[0] as any)[0].input.TransactItems;
    expect(items[0].Put.Item).toMatchObject({ PK: 'PAYMENT#pay-1', SK: 'REPORT', rev: 1 });
    expect(items[0].Put.ConditionExpression).toBe('attribute_not_exists(PK)');
    expect(items[1].Put.Item).toMatchObject({ PK: 'PAYLINE#2026-09', SK: `${l.line.at}#pay-1`, amount: 100 });
    expect(items.slice(2).map((i: any) => i.Update.Key)).toEqual([
      { PK: 'PAYAGG#2026', SK: 'D#2026-09-22#charge#-#-' },
      { PK: 'PAYAGG#2026', SK: 'M#2026-09#charge#-#-' },
    ]);
    expect(items[2].Update.UpdateExpression).toContain('ADD #n :n, #a :a, #t :t, #f :f');
  });

  it('guards on the pointer rev and deletes the lines that went away', async () => {
    const send = jest.fn(async () => ({}));
    const old = lineOf({ amount: 100, takenAt: '2026-08-10T15:00:00.000Z' });
    const moved = lineOf({ amount: 100, takenAt: '2026-09-10T15:00:00.000Z' });
    await repoWith(send).commit('pay-1', { lines: [old.pointer], rev: 4 }, [moved], new Map());
    const items = (send.mock.calls[0] as any)[0].input.TransactItems;
    expect(items[0].Put.Item.rev).toBe(5);
    expect(items[0].Put.ExpressionAttributeValues).toEqual({ ':rev': 4 });
    expect(items[1].Delete.Key).toEqual({ PK: 'PAYLINE#2026-08', SK: old.pointer.sk });
  });

  it('two days of one month make ONE month update (a transaction cannot touch an item twice)', async () => {
    const send = jest.fn(async () => ({}));
    const c = { n: 1, amountCents: 100, tipsCents: 0, feesCents: 0 };
    await repoWith(send).commit(
      'pay-1',
      { lines: [], rev: 1 },
      [],
      new Map([
        ['2026-09-01#cash#-#-', c],
        ['2026-09-02#cash#-#-', c],
      ]),
    );
    const items = (send.mock.calls[0] as any)[0].input.TransactItems;
    const monthUpdates = items.filter((i: any) => i.Update?.Key.SK.startsWith('M#'));
    expect(monthUpdates).toHaveLength(1);
    expect(monthUpdates[0].Update.ExpressionAttributeValues[':n']).toBe(2);
    // No lines left → the pointer is deleted, rev-guarded.
    expect(items[0].Delete).toMatchObject({ Key: { PK: 'PAYMENT#pay-1', SK: 'REPORT' } });
  });

  it('nothing to write sends nothing; a cancelled transaction is a conflict', async () => {
    const send = jest.fn(async () => ({}));
    await repoWith(send).commit('pay-1', null, [], new Map());
    expect(send).not.toHaveBeenCalled();

    const failing = jest.fn(async () => {
      throw Object.assign(new Error('x'), { name: 'TransactionCanceledException' });
    });
    await expect(repoWith(failing).commit('pay-1', null, [lineOf()], new Map())).rejects.toBeInstanceOf(
      ReportProjectionConflictError,
    );
  });
});

describe('PaymentReportRepository.walkLines', () => {
  const item = (month: string, at: string, id: string, extra: Record<string, unknown> = {}) => ({
    PK: `PAYLINE#${month}`,
    SK: `${at}#${id}`,
    entityType: 'payment_report_line',
    lineId: id,
    at,
    amount: 1,
    type: 'cash',
    ...extra,
  });

  it('stops mid-response on the last line it TOOK, and resumes right after it', async () => {
    const send = jest.fn(async () => ({
      Items: [item('2026-09', '2026-09-03T00:00:00Z', 'a'), item('2026-09', '2026-09-02T00:00:00Z', 'b'), item('2026-09', '2026-09-01T00:00:00Z', 'c')],
    }));
    const res = await repoWith(send).walkLines({
      cursor: { ms: ['2026-09', '2026-08'] },
      fromIso: '2026-08-01T04:00:00.000Z',
      toIso: '2026-10-01T04:00:00.000Z',
      dir: 'desc',
      filter: { types: [], technicianIds: [], serviceAreaIds: [] },
      want: 2,
    });
    expect(res.lines.map((l) => l.lineId)).toEqual(['a', 'b']);
    expect(res.next).toEqual({ ms: ['2026-09', '2026-08'], k: { PK: 'PAYLINE#2026-09', SK: '2026-09-02T00:00:00Z#b' } });
    const input = (send.mock.calls[0] as any)[0].input;
    expect(input.ScanIndexForward).toBe(false);
    expect(input.KeyConditionExpression).toBe('PK = :pk AND SK BETWEEN :a AND :b');
  });

  it('walks into the next month when one runs out, and filters with IN lists', async () => {
    const send = jest
      .fn()
      .mockResolvedValueOnce({ Items: [item('2026-09', '2026-09-01T00:00:00Z', 'a')] })
      .mockResolvedValueOnce({ Items: [item('2026-08', '2026-08-31T00:00:00Z', 'b'), item('2026-08', '2026-08-30T00:00:00Z', 'c')] });
    const res = await repoWith(send).walkLines({
      cursor: { ms: ['2026-09', '2026-08'] },
      fromIso: 'a',
      toIso: 'z',
      dir: 'desc',
      filter: { types: ['refund', 'refund_offline'], technicianIds: ['t1'], serviceAreaIds: [] },
      want: 10,
    });
    expect(res.lines.map((l) => l.lineId)).toEqual(['a', 'b', 'c']);
    expect(res.next).toBeUndefined();
    expect(res.exhausted).toBe(true);
    const input = (send.mock.calls[0] as any)[0].input;
    expect(input.FilterExpression).toBe('#ty IN (:ty0, :ty1) AND #te IN (:te0)');
    expect(input.ExpressionAttributeNames).toEqual({ '#ty': 'type', '#te': 'technicianId' });
  });

  it('the in-memory part of the filter (search) never makes a page skip a line', async () => {
    const send = jest.fn(async () => ({
      Items: [item('2026-09', '3', 'x'), item('2026-09', '2', 'match', { reference: 'R1' }), item('2026-09', '1', 'y')],
      LastEvaluatedKey: { PK: 'PAYLINE#2026-09', SK: '1#y' },
    }));
    const res = await repoWith(send).walkLines({
      cursor: { ms: ['2026-09'] },
      fromIso: '0',
      toIso: '9',
      dir: 'desc',
      filter: { types: [], technicianIds: [], serviceAreaIds: [] },
      want: 1,
      accept: (l) => l.reference === 'R1',
    });
    expect(res.lines.map((l) => l.lineId)).toEqual(['match']);
    expect(res.next?.k).toEqual({ PK: 'PAYLINE#2026-09', SK: '2#match' });
  });
});

describe('PaymentReportRepository.readBuckets', () => {
  it('reads each plan range and splits the sort key back into period and bucket', async () => {
    const send = jest.fn(async () => ({
      Items: [{ SK: 'D#2026-09-02#charge#t1#-', n: 2, amountCents: 500, tipsCents: 10, feesCents: 3 }],
    }));
    const rows = await repoWith(send).readBuckets([{ year: '2026', kind: 'D', from: '2026-09-01', to: '2026-09-27' }]);
    expect(rows).toEqual([{ period: '2026-09-02', bucket: 'charge#t1#-', n: 2, amountCents: 500, tipsCents: 10, feesCents: 3 }]);
    expect((send.mock.calls[0] as any)[0].input.ExpressionAttributeValues).toEqual({
      ':pk': 'PAYAGG#2026',
      ':a': 'D#2026-09-01',
      ':b': 'D#2026-09-27#~',
    });
  });
});
