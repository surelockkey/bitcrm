import { StoredDealTotals } from '../../src/calls/stored-deal-totals';
import { SUMMARY_ATTRIBUTES, type SummaryCall } from '../../src/calls/call-summary';
import { TRACKED_CALL_ATTRIBUTES, type TrackedCall } from '../../src/calls/tracking/call-tracking';
import { CallsService } from '../../src/calls/calls.service';
import { CallTrackingService } from '../../src/calls/tracking/call-tracking.service';
import { CallsExportService } from '../../src/calls/calls-export.service';
import { type CallRecord } from '../../src/calls/calls.repository';

/**
 * The call reports used to ask deal-service for the total of EVERY linked job
 * (`POST /deals/internal/deal-totals`, up to 4×1,000 ids, throttled retries).
 * A linked call now carries its job's total (`dealTotal`, kept fresh from
 * deal-events), so the reports read it off the rows they already walk and ask
 * deal-service only for the rows that have none yet (old data).
 */

describe('StoredDealTotals', () => {
  it('collects the totals the rows carry, per deal', () => {
    const s = new StoredDealTotals();
    s.add({ dealId: 'd1', dealTotal: 120.5, dealTotalAt: '2026-10-01T00:00:00.000Z' });
    s.add({ dealId: 'd2' });
    s.add({ dealTotal: 99 }); // no deal → nothing

    expect([...s.totals]).toEqual([['d1', 120.5]]);
    expect(s.missing(['d1', 'd2', 'd3'])).toEqual(['d2', 'd3']);
  });

  it('two calls of one job: the freshest stamp wins', () => {
    const s = new StoredDealTotals();
    s.add({ dealId: 'd1', dealTotal: 100, dealTotalAt: '2026-10-02T00:00:00.000Z' });
    s.add({ dealId: 'd1', dealTotal: 50, dealTotalAt: '2026-10-01T00:00:00.000Z' });
    s.add({ dealId: 'd1', dealTotal: 75, dealTotalAt: '2026-10-03T00:00:00.000Z' });

    expect(s.totals.get('d1')).toBe(75);
  });

  it('ignores a total that is not a finite number', () => {
    const s = new StoredDealTotals();
    s.add({ dealId: 'd1', dealTotal: 'abc' as never });
    s.add({ dealId: 'd2', dealTotal: Number.NaN });

    expect(s.totals.size).toBe(0);
  });

  it('merge: stored totals plus the fetched ones', () => {
    const s = new StoredDealTotals();
    s.add({ dealId: 'd1', dealTotal: 10 });

    expect([...s.merged(new Map([['d2', 20]]))].sort()).toEqual([
      ['d1', 10],
      ['d2', 20],
    ]);
  });
});

describe('the reports project the stored total', () => {
  it('summary and Call Tracking read dealTotal + dealTotalAt off the rows', () => {
    expect(SUMMARY_ATTRIBUTES).toEqual(expect.arrayContaining(['dealTotal', 'dealTotalAt']));
    expect(TRACKED_CALL_ATTRIBUTES).toEqual(expect.arrayContaining(['dealTotal', 'dealTotalAt']));
  });
});

const oneMonth = { dateFrom: '2026-08-01T00:00:00.000Z', dateTo: '2026-08-31T23:59:59.999Z' };

const call = (over: Partial<SummaryCall> = {}): SummaryCall => ({
  callSid: 'CA1',
  startedAt: '2026-08-08T15:00:00.000Z',
  direction: 'inbound',
  from: '+12035550101',
  to: '+12034036303',
  status: 'completed',
  answeredAt: '2026-08-08T15:00:05.000Z',
  ...over,
});

describe('CallsService.summary — revenue off the rows', () => {
  function make(rows: SummaryCall[], totals: Map<string, number> | Error = new Map()) {
    const repo = {
      walkSelection: jest.fn(async (_f: unknown, _a: unknown, onRow: (r: SummaryCall) => void) => {
        rows.forEach(onRow);
        return { atLeast: false };
      }),
    };
    const deals = {
      totals: jest.fn(async () => {
        if (totals instanceof Error) throw totals;
        return totals;
      }),
    };
    const service = new CallsService(
      repo as never,
      undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      deals as never,
    );
    return { service, deals };
  }

  it('every linked row carries its total → deal-service is not asked at all', async () => {
    const { service, deals } = make([
      call({ dealId: 'd1', dealTotal: 100 }),
      call({ callSid: 'CA2', dealId: 'd2', dealTotal: 23.45 }),
    ]);

    const out = await service.summary(oneMonth, { withRevenue: true });

    expect(out.revenue).toBe(123.45);
    expect(deals.totals).not.toHaveBeenCalled();
  });

  it('asks only for the jobs whose rows carry none (old data)', async () => {
    const { service, deals } = make(
      [call({ dealId: 'd1', dealTotal: 100 }), call({ callSid: 'CA2', dealId: 'd2' })],
      new Map([['d2', 5]]),
    );

    const out = await service.summary(oneMonth, { withRevenue: true });

    expect(deals.totals).toHaveBeenCalledWith(['d2']);
    expect(out.revenue).toBe(105);
  });

  it('the fallback failing still costs the revenue, never prints a partial sum', async () => {
    const { service } = make(
      [call({ dealId: 'd1', dealTotal: 100 }), call({ callSid: 'CA2', dealId: 'd2' })],
      new Error('down'),
    );

    const out = await service.summary(oneMonth, { withRevenue: true });

    expect(out).not.toHaveProperty('revenue');
  });
});

describe('CallTrackingService — revenue off the rows', () => {
  const inbound = (over: Partial<TrackedCall> = {}): TrackedCall => ({
    callSid: 'CA1',
    startedAt: '2026-09-10T15:00:00.000Z',
    direction: 'inbound',
    from: '+15550001111',
    to: '+12034036303',
    flowId: 'flow-ct',
    flowName: 'SURE CT',
    externalId: 'workiz:call:1',
    dialCallStatus: 'completed',
    durationSeconds: 60,
    ...over,
  });

  function make(calls: TrackedCall[], fetched = new Map<string, number>()) {
    const repo = {
      walk: jest.fn(async (_w: unknown, onCall: (c: TrackedCall) => void) => {
        calls.forEach(onCall);
        return { atLeast: false, queries: 1 };
      }),
    };
    const deals = { totals: jest.fn(async () => fetched) };
    const svc = new CallTrackingService(repo as never, deals as never, undefined, undefined, undefined);
    return { svc, deals };
  }

  it('uses the stored totals and fetches only the missing ones', async () => {
    const { svc, deals } = make(
      [
        inbound({ dealId: 'd1', dealTotal: 120.5 }),
        inbound({ callSid: 'CA2', from: '+15550002222', dealId: 'd2' }),
      ],
      new Map([['d2', 9.5]]),
    );

    const report = await svc.report(
      { from: '2026-09-01', to: '2026-09-27' },
      { withRevenue: true, now: new Date('2026-09-30T16:00:00.000Z') },
    );

    expect(deals.totals).toHaveBeenCalledWith(['d2']);
    expect(report.rows[0].revenue).toBe(130);
  });

  it('nothing missing → no deal-service call', async () => {
    const { svc, deals } = make([inbound({ dealId: 'd1', dealTotal: 1 })]);

    await svc.report(
      { from: '2026-09-01', to: '2026-09-27' },
      { withRevenue: true, now: new Date('2026-09-30T16:00:00.000Z') },
    );

    expect(deals.totals).not.toHaveBeenCalled();
  });
});

describe('CallsExportService — Revenue off the rows', () => {
  const rec = (sid: string, over: Partial<CallRecord> = {}): CallRecord => ({
    callSid: sid,
    direction: 'inbound',
    status: 'completed',
    from: '+18572949311',
    to: '+12034036303',
    startedAt: '2026-10-08T19:15:00.000Z',
    updatedAt: '2026-10-08T19:16:00.000Z',
    ...over,
  });

  it('a row with a stored total is never asked about', async () => {
    const calls = {
      list: jest.fn(async () => ({
        items: [rec('CA1', { dealId: 'd1', dealTotal: 42 }), rec('CA2', { dealId: 'd2' })],
      })),
    };
    const dealTotals = { totals: jest.fn(async (ids: string[]) => new Map(ids.map((id) => [id, 7]))) };
    const service = new CallsExportService(calls as never, undefined, undefined, undefined, dealTotals as never);
    const lines: string[] = [];
    const sink = { write: jest.fn(async (chunk: string) => void lines.push(...chunk.split('\n').filter(Boolean))) };

    await service.stream(
      {},
      { money: true, maySeeNumbers: true, name: async (items) => items },
      sink,
    );

    expect(dealTotals.totals).toHaveBeenCalledWith(['d2']);
    expect(lines[1].endsWith(',42.00')).toBe(true);
    expect(lines[2].endsWith(',7.00')).toBe(true);
  });
});
