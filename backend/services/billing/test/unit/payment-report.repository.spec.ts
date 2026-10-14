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

describe('PaymentReportRepository.walkLines — months side by side', () => {
  const item = (month: string, at: string, id: string) => ({
    PK: `PAYLINE#${month}`,
    SK: `${at}#${id}`,
    entityType: 'payment_report_line',
    lineId: id,
    at,
    amount: 1,
    type: 'cash',
  });
  const months = ['2026-09', '2026-08', '2026-07', '2026-06', '2026-05', '2026-04'];
  const base = {
    fromIso: '0',
    toIso: '9',
    dir: 'desc' as const,
    filter: { types: [], technicianIds: [], serviceAreaIds: [] },
  };

  /** One line per month; every Query is held until released, so what is in flight can be inspected. */
  function heldTable(perMonth: Record<string, Array<ReturnType<typeof item>>>) {
    const waiting: Array<() => void> = [];
    const asked: string[] = [];
    const send = jest.fn((cmd: any) => {
      const pk = cmd.input.ExpressionAttributeValues[':pk'] as string;
      asked.push(pk);
      return new Promise((resolve) =>
        waiting.push(() => resolve({ Items: perMonth[pk.slice('PAYLINE#'.length)] ?? [] })),
      );
    });
    const releaseAll = async () => {
      // Let the walk issue what it will, release, repeat until it settles.
      for (let i = 0; i < 50; i++) {
        await new Promise((r) => setImmediate(r));
        while (waiting.length) waiting.shift()!();
      }
    };
    return { send, asked, waiting, releaseAll };
  }
  const oneEach = Object.fromEntries(months.map((m, i) => [m, [item(m, `${m}-1${i}`, `l-${m}`)]]));

  it('the bucket counts say the page needs three months: all three are asked before the first answers', async () => {
    const t = heldTable(oneEach);
    const walk = repoWith(t.send).walkLines({
      ...base,
      cursor: { ms: months },
      want: 3,
      expected: new Map(months.map((m) => [m, 1])),
    });
    await new Promise((r) => setImmediate(r));
    expect(t.asked).toEqual(['PAYLINE#2026-09', 'PAYLINE#2026-08', 'PAYLINE#2026-07']);
    await t.releaseAll();
    const res = await walk;
    expect(res.lines.map((l) => l.lineId)).toEqual(['l-2026-09', 'l-2026-08', 'l-2026-07']);
    expect(res.next).toEqual({ ms: ['2026-06', '2026-05', '2026-04'] });
  });

  it('a month the counts say is enough is read alone', async () => {
    const t = heldTable({ '2026-09': [item('2026-09', '3', 'a'), item('2026-09', '2', 'b')] });
    const walk = repoWith(t.send).walkLines({
      ...base,
      cursor: { ms: months },
      want: 2,
      expected: new Map([['2026-09', 40], ['2026-08', 40]]),
    });
    await t.releaseAll();
    expect((await walk).lines.map((l) => l.lineId)).toEqual(['a', 'b']);
    expect(t.asked).toEqual(['PAYLINE#2026-09']);
  });

  it('without counts it reads one month, then — once a month ran dry — up to four at a time', async () => {
    const t = heldTable(oneEach);
    const walk = repoWith(t.send).walkLines({ ...base, cursor: { ms: months }, want: 10 });
    await new Promise((r) => setImmediate(r));
    expect(t.asked).toEqual(['PAYLINE#2026-09']);
    t.waiting.shift()!();
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    // The month being read plus three ahead.
    expect(t.asked).toEqual(['PAYLINE#2026-09', 'PAYLINE#2026-08', 'PAYLINE#2026-07', 'PAYLINE#2026-06', 'PAYLINE#2026-05']);
    await t.releaseAll();
    const res = await walk;
    expect(res.lines.map((l) => l.lineId)).toEqual(months.map((m) => `l-${m}`));
    expect(res.exhausted).toBe(true);
    // Every month asked exactly once.
    expect([...t.asked].sort()).toEqual(months.map((m) => `PAYLINE#${m}`).sort());
  });

  it('a month with more pages is finished, in order, before the next month’s lines are taken', async () => {
    const send = jest.fn(async (cmd: any) => {
      const pk = cmd.input.ExpressionAttributeValues[':pk'];
      const start = cmd.input.ExclusiveStartKey;
      if (pk === 'PAYLINE#2026-09' && !start) {
        return { Items: [item('2026-09', '9', 'a')], LastEvaluatedKey: { PK: pk, SK: '9#a' } };
      }
      if (pk === 'PAYLINE#2026-09') return { Items: [item('2026-09', '8', 'b')] };
      return { Items: [item(pk.slice(8), '1', `x-${pk.slice(8)}`)] };
    });
    const res = await repoWith(send).walkLines({
      ...base,
      cursor: { ms: months.slice(0, 3) },
      want: 4,
      expected: new Map([['2026-09', 2], ['2026-08', 1], ['2026-07', 1]]),
    });
    expect(res.lines.map((l) => l.lineId)).toEqual(['a', 'b', 'x-2026-08', 'x-2026-07']);
  });

  it('a read-ahead month that fails but is never needed does not fail the walk', async () => {
    const send = jest.fn(async (cmd: any) => {
      const pk = cmd.input.ExpressionAttributeValues[':pk'];
      if (pk === 'PAYLINE#2026-07') throw new Error('throttled');
      return { Items: [item(pk.slice(8), '1', `x-${pk.slice(8)}`)] };
    });
    const res = await repoWith(send).walkLines({
      ...base,
      cursor: { ms: months.slice(0, 3) },
      want: 2,
      expected: new Map([['2026-09', 1], ['2026-08', 0], ['2026-07', 5]]),
    });
    expect(res.lines.map((l) => l.lineId)).toEqual(['x-2026-09', 'x-2026-08']);
  });
});
