import { DynamoDbService } from '@bitcrm/shared';
import { CallsSummaryTally, SUMMARY_ATTRIBUTES, type SummaryCall } from '../../src/calls/call-summary';
import { CallsRepository, type ListCallsFilter } from '../../src/calls/calls.repository';
import { CallsService } from '../../src/calls/calls.service';

/**
 * Картки над журналом дзвінків — Workiz-ові `aggs` (MISSED CALLS, CALLS +
 * «N callers», REVENUE). Ті самі фільтри, що й у рядків, той самий обмежений
 * прохід, що й у лічильника — тож CALLS дорівнює «of N» під таблицею.
 */

const call = (over: Partial<SummaryCall> = {}): SummaryCall => ({
  callSid: 'CA1',
  startedAt: '2026-10-08T15:00:00.000Z',
  direction: 'inbound',
  from: '+12035550101',
  to: '+12034036303',
  status: 'completed',
  answeredAt: '2026-10-08T15:00:05.000Z',
  ...over,
});

describe('CallsSummaryTally', () => {
  it('counts every call it is given — the table total', () => {
    const t = new CallsSummaryTally();
    t.add(call());
    t.add(call({ callSid: 'CA2', direction: 'outbound', from: '+12034036303', to: '+12035550199' }));

    expect(t.result({ atLeast: false }).calls).toBe(2);
  });

  it('callers are the distinct OUTSIDE numbers: inbound from, outbound to', () => {
    const t = new CallsSummaryTally();
    t.add(call({ from: '+12035550101' }));
    t.add(call({ callSid: 'CA2', from: '+12035550101' }));
    // Outbound: our number dialled them — the far side is `to`.
    t.add(call({ callSid: 'CA3', direction: 'outbound', from: '+12034036303', to: '+12035550101' }));
    t.add(call({ callSid: 'CA4', direction: 'outbound', from: '+12034036303', to: '+12035550199' }));

    expect(t.result({ atLeast: false }).callers).toBe(2);
  });

  it('never counts a browser leg or a blank as a caller', () => {
    const t = new CallsSummaryTally();
    t.add(call({ from: 'client:u1' }));
    t.add(call({ callSid: 'CA2', from: undefined }));

    expect(t.result({ atLeast: false }).callers).toBe(0);
  });

  it('missed = inbound calls by the Call Tracking rule (answerClassOf)', () => {
    const t = new CallsSummaryTally();
    // Ours, nobody picked up, over.
    t.add(call({ callSid: 'CA1', status: 'no-answer', answeredAt: undefined }));
    // Ours, answered.
    t.add(call({ callSid: 'CA2' }));
    // Still ringing — not missed yet.
    t.add(call({ callSid: 'CA3', status: 'ringing', answeredAt: undefined }));
    // Imported: empty dial status is missed …
    t.add(call({ callSid: 'CA4', externalId: 'workiz:call:1', dialCallStatus: '', status: 'completed' }));
    // … unless the flow's voicemail box took it (voicemail 2) — neither column.
    t.add(call({ callSid: 'CA5', externalId: 'workiz:call:2', voicemail: 2, status: 'completed' }));
    // Outbound never counts as missed, whatever its status.
    t.add(call({ callSid: 'CA6', direction: 'outbound', status: 'no-answer', answeredAt: undefined }));

    expect(t.result({ atLeast: false }).missed).toBe(2);
  });

  it('active = calls still going', () => {
    const t = new CallsSummaryTally();
    t.add(call({ status: 'in-progress' }));
    t.add(call({ callSid: 'CA2', status: 'ringing', answeredAt: undefined }));
    t.add(call({ callSid: 'CA3' }));

    expect(t.result({ atLeast: false }).active).toBe(2);
  });

  it('jobs = distinct linked jobs, Workiz job ids of jobs that never became deals included', () => {
    const t = new CallsSummaryTally();
    t.add(call({ dealId: 'd1' }));
    t.add(call({ callSid: 'CA2', dealId: 'd1' }));
    t.add(call({ callSid: 'CA3', dealId: 'd2' }));
    t.add(call({ callSid: 'CA4', workizJobId: '375982' }));
    t.add(call({ callSid: 'CA5' }));

    expect(t.result({ atLeast: false }).jobs).toBe(3);
    // Only real deals have a total to sum.
    expect(t.dealIds().sort()).toEqual(['d1', 'd2']);
  });

  it('revenue = Σ the linked deals’ totals, each deal once, to the cent', () => {
    const t = new CallsSummaryTally();
    t.add(call({ dealId: 'd1' }));
    t.add(call({ callSid: 'CA2', dealId: 'd1' }));
    t.add(call({ callSid: 'CA3', dealId: 'd2' }));

    // 0.1 + 0.2 in floating point is 0.30000000000000004 — the card prints cents.
    const out = t.result({ atLeast: false, totals: new Map([['d1', 0.1], ['d2', 0.2]]) });

    expect(out.revenue).toBe(0.3);
  });

  it('no totals given → no revenue key at all (money is never guessed as 0)', () => {
    const t = new CallsSummaryTally();
    t.add(call({ dealId: 'd1' }));

    expect(t.result({ atLeast: false })).not.toHaveProperty('revenue');
  });

  it('carries the walk’s floor flag', () => {
    expect(new CallsSummaryTally().result({ atLeast: true }).atLeast).toBe(true);
  });

  it('projects what the rules read and nothing that would leak a body', () => {
    expect(SUMMARY_ATTRIBUTES).toEqual(
      expect.arrayContaining(['direction', 'from', 'to', 'status', 'answeredAt', 'dealId', 'workizJobId', 'externalId', 'dialCallStatus', 'voicemail']),
    );
    expect(SUMMARY_ATTRIBUTES).not.toContain('participants');
    expect(SUMMARY_ATTRIBUTES).not.toContain('flowPath');
  });
});

function makeRepo(pages: Array<{ Items?: unknown[]; LastEvaluatedKey?: unknown }>) {
  const sent: Array<{ input: Record<string, any> }> = [];
  let i = 0;
  const client = {
    send: jest.fn(async (cmd: { input: Record<string, any> }) => {
      sent.push(cmd);
      const res = pages[Math.min(i, pages.length - 1)] ?? { Items: [] };
      i += 1;
      return res;
    }),
  };
  const repo = new CallsRepository({ client } as unknown as DynamoDbService);
  return { repo, sent };
}

const oneMonth: ListCallsFilter = {
  dateFrom: '2026-08-01T00:00:00.000Z',
  dateTo: '2026-08-31T23:59:59.999Z',
};

describe('CallsRepository.walkSelection', () => {
  it('walks the same months, with the same filter, as the count', async () => {
    const { repo, sent } = makeRepo([{ Items: [] }]);

    await repo.walkSelection({ ...oneMonth, status: 'completed' }, ['direction'], () => undefined);

    expect(sent[0].input.IndexName).toBe('AllCallsIndex');
    expect(sent[0].input.ExpressionAttributeValues[':allPk']).toBe('CALL#2026-08');
    expect(sent[0].input.FilterExpression).toContain('#status = :status');
    expect(sent[0].input.FilterExpression).toContain('attribute_not_exists(internalLegOf)');
    // Same page size as the count (no Limit): the budget reads the same rows.
    expect(sent[0].input.Limit).toBeUndefined();
  });

  it('projects only the attributes asked for, and hands each row over', async () => {
    const { repo, sent } = makeRepo([
      { Items: [{ direction: 'inbound' }], LastEvaluatedKey: { PK: 'x' } },
      { Items: [{ direction: 'outbound' }] },
    ]);
    const seen: unknown[] = [];

    const out = await repo.walkSelection(oneMonth, ['direction', 'from'], (row) => seen.push(row));

    expect(seen).toEqual([{ direction: 'inbound' }, { direction: 'outbound' }]);
    expect(out).toEqual({ atLeast: false });
    expect(sent[1].input.ExclusiveStartKey).toEqual({ PK: 'x' });
    const projected = String(sent[0].input.ProjectionExpression)
      .split(', ')
      .map((alias) => sent[0].input.ExpressionAttributeNames[alias]);
    expect(projected).toEqual(['direction', 'from']);
  });

  it('stops on the count’s budget and says the tally is a floor', async () => {
    const { repo, sent } = makeRepo([{ Items: [{}], LastEvaluatedKey: { PK: 'x' } }]);

    const out = await repo.walkSelection(oneMonth, ['direction'], () => undefined);

    expect(out.atLeast).toBe(true);
    expect(sent.length).toBeLessThanOrEqual(60);
  });
});

describe('CallsService.summary', () => {
  function make(opts: { rows?: SummaryCall[]; atLeast?: boolean; totals?: Map<string, number> | Error; redis?: boolean } = {}) {
    const repo = {
      walkSelection: jest.fn(async (_f: unknown, _a: unknown, onRow: (r: SummaryCall) => void) => {
        for (const r of opts.rows ?? []) onRow(r);
        return { atLeast: !!opts.atLeast };
      }),
    };
    const deals = {
      totals: jest.fn(async () => {
        if (opts.totals instanceof Error) throw opts.totals;
        return opts.totals ?? new Map();
      }),
    };
    const store = new Map<string, string>();
    const redis = {
      client: {
        get: jest.fn(async (k: string) => store.get(k) ?? null),
        set: jest.fn(async (k: string, v: string, ..._rest: unknown[]) => void store.set(k, v)),
      },
    };
    const service = new CallsService(
      repo as never,
      undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      (opts.redis ? redis : undefined) as never,
      deals as never,
    );
    return { service, repo, deals, redis, store };
  }

  it('tallies the rows the filter selects', async () => {
    const { service, repo } = make({
      rows: [call({ dealId: 'd1' }), call({ callSid: 'CA2', status: 'no-answer', answeredAt: undefined })],
    });

    const out = await service.summary(oneMonth, { withRevenue: false });

    expect(out).toEqual({ calls: 2, callers: 1, missed: 1, active: 0, jobs: 1, atLeast: false });
    expect(repo.walkSelection.mock.calls[0][0]).toEqual(oneMonth);
    expect(repo.walkSelection.mock.calls[0][1]).toEqual(SUMMARY_ATTRIBUTES);
  });

  it('asks deal-service for money only for a viewer who may see it', async () => {
    const { service, deals } = make({ rows: [call({ dealId: 'd1' })], totals: new Map([['d1', 692.8]]) });

    const without = await service.summary(oneMonth, { withRevenue: false });
    expect(deals.totals).not.toHaveBeenCalled();
    expect(without).not.toHaveProperty('revenue');

    const withMoney = await service.summary(oneMonth, { withRevenue: true });
    expect(deals.totals).toHaveBeenCalledWith(['d1']);
    expect(withMoney.revenue).toBe(692.8);
  });

  it('no linked deals → revenue is 0 without asking anybody', async () => {
    const { service, deals } = make({ rows: [call()] });

    const out = await service.summary(oneMonth, { withRevenue: true });

    expect(out.revenue).toBe(0);
    expect(deals.totals).not.toHaveBeenCalled();
  });

  it('deal-service failing costs the revenue, not the cards — and is not cached', async () => {
    const { service, redis } = make({ rows: [call({ dealId: 'd1' })], totals: new Error('down'), redis: true });

    const out = await service.summary(oneMonth, { withRevenue: true });

    expect(out.calls).toBe(1);
    expect(out).not.toHaveProperty('revenue');
    expect(redis.client.set).not.toHaveBeenCalled();
  });

  it('a second ask within thirty seconds does not walk the log again', async () => {
    const { service, repo, redis } = make({ rows: [call()], redis: true });

    await service.summary(oneMonth, { withRevenue: false });
    const again = await service.summary(oneMonth, { withRevenue: false });

    expect(repo.walkSelection).toHaveBeenCalledTimes(1);
    expect(again.calls).toBe(1);
    expect(redis.client.set.mock.calls[0][2]).toBe('EX');
    expect(redis.client.set.mock.calls[0][3]).toBe(30);
  });

  it('money and no-money answers are kept apart', async () => {
    const { service, repo } = make({ rows: [call({ dealId: 'd1' })], totals: new Map([['d1', 5]]), redis: true });

    await service.summary(oneMonth, { withRevenue: false });
    const withMoney = await service.summary(oneMonth, { withRevenue: true });

    expect(repo.walkSelection).toHaveBeenCalledTimes(2);
    expect(withMoney.revenue).toBe(5);
  });

  it('a cache that is down is a miss, not a failed card', async () => {
    const { service, redis } = make({ rows: [call()], redis: true });
    redis.client.get.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    redis.client.set.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    await expect(service.summary(oneMonth, { withRevenue: false })).resolves.toMatchObject({ calls: 1 });
  });
});
