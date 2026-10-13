import { DynamoDbService } from '@bitcrm/shared';
import { CallsRepository, type CallRecord } from '../../src/calls/calls.repository';
import { CallCountersRepository, monthFullyCovered } from '../../src/calls/call-counters.repository';
import { CallsService } from '../../src/calls/calls.service';
import { planRecount } from '../../src/scripts/recount-calls';

/**
 * `GET /calls/count` with no filter started in 2015 and ran up to 60
 * sequential queries. Every call that enters the log now ADDs one to its
 * month's counter (`CALLCOUNT` / `MONTH#<YYYY-MM>`), and an unfiltered or
 * date-only count reads the counters for the months it covers whole — the
 * edge months of a date window are still counted off the log. Until
 * `recount:calls` has stamped `CALLCOUNT` / `STATE`, the counters are not
 * trusted and the walk answers as before.
 */

function fakeClient(responder: (cmd: { name: string; input: Record<string, any> }) => unknown = () => ({})) {
  const sent: Array<{ name: string; input: Record<string, any> }> = [];
  const client = {
    send: jest.fn(async (cmd: { constructor: { name: string }; input: Record<string, any> }) => {
      const entry = { name: cmd.constructor.name, input: cmd.input };
      sent.push(entry);
      const res = responder(entry);
      if (res instanceof Error) throw res;
      return res;
    }),
  };
  return { db: { client } as unknown as DynamoDbService, sent };
}

const rec = (over: Partial<CallRecord> = {}): CallRecord => ({
  callSid: 'CA1',
  startedAt: '2026-08-05T10:00:00.000Z',
  updatedAt: '2026-08-05T10:00:00.000Z',
  ...over,
});

describe('CallsRepository.upsert — says when a row first entered the log', () => {
  it('asks for the old values and reports a first write', async () => {
    const { db, sent } = fakeClient(() => ({}));
    const repo = new CallsRepository(db);

    await expect(repo.upsert(rec())).resolves.toEqual({ created: true, becameInternal: false });
    expect(sent[0].input.ReturnValues).toBe('UPDATED_OLD');
  });

  it('a later write of the same call is not a creation', async () => {
    const { db } = fakeClient(() => ({
      Attributes: { GSI2SK: '2026-08-05T10:00:00.000Z#CA1', startedAt: '2026-08-05T10:00:00.000Z' },
    }));

    await expect(new CallsRepository(db).upsert(rec({ status: 'completed' }))).resolves.toEqual({
      created: false,
      becameInternal: false,
    });
  });

  it('a row already in the log that turns out to be an internal leg says so, with its month', async () => {
    const { db } = fakeClient(() => ({
      Attributes: { GSI2SK: '2026-07-31T23:59:00.000Z#CA1', startedAt: '2026-07-31T23:59:00.000Z' },
    }));

    await expect(new CallsRepository(db).upsert(rec({ internalLegOf: 'CA0' }))).resolves.toEqual({
      created: false,
      becameInternal: true,
      startedAt: '2026-07-31T23:59:00.000Z',
    });
  });

  it('an internal leg that was already one is not reported again', async () => {
    const { db } = fakeClient(() => ({
      Attributes: { GSI2SK: 'x', startedAt: '2026-08-05T10:00:00.000Z', internalLegOf: 'CA0' },
    }));

    await expect(new CallsRepository(db).upsert(rec({ internalLegOf: 'CA0' }))).resolves.toMatchObject({
      becameInternal: false,
    });
  });
});

describe('CallCountersRepository', () => {
  it('ADDs to the month row of one partition', async () => {
    const { db, sent } = fakeClient();
    await new CallCountersRepository(db).bump('2026-08', 1);

    expect(sent[0].input.Key).toEqual({ PK: 'CALLCOUNT', SK: 'MONTH#2026-08' });
    expect(sent[0].input.UpdateExpression).toContain('ADD #count :d');
    expect(sent[0].input.ExpressionAttributeValues[':d']).toBe(1);
  });

  it('reads a range of months in one query', async () => {
    const { db, sent } = fakeClient(() => ({
      Items: [
        { SK: 'MONTH#2026-07', count: 4 },
        { SK: 'MONTH#2026-08', count: 6 },
      ],
    }));

    const months = await new CallCountersRepository(db).months('2026-06', '2026-08');

    expect(months).toEqual(new Map([['2026-07', 4], ['2026-08', 6]]));
    expect(sent[0].input.ExpressionAttributeValues).toMatchObject({
      ':pk': 'CALLCOUNT',
      ':lo': 'MONTH#2026-06',
      ':hi': 'MONTH#2026-08',
    });
  });

  it('ready only once recount stamped the state row', async () => {
    const { db } = fakeClient((c) => (c.name === 'GetCommand' ? { Item: { readyAt: '2026-10-13T00:00:00.000Z' } } : {}));
    await expect(new CallCountersRepository(db).ready()).resolves.toBe(true);

    const { db: empty } = fakeClient(() => ({}));
    await expect(new CallCountersRepository(empty).ready()).resolves.toBe(false);
  });
});

describe('monthFullyCovered', () => {
  it('no bounds → every month is whole', () => {
    expect(monthFullyCovered('2026-08')).toBe(true);
  });

  it('a lower bound on or before the 1st covers it', () => {
    expect(monthFullyCovered('2026-08', '2026-08-01')).toBe(true);
    expect(monthFullyCovered('2026-08', '2026-08-01T00:00:00.000Z')).toBe(true);
    expect(monthFullyCovered('2026-08', '2026-07-15')).toBe(true);
    expect(monthFullyCovered('2026-08', '2026-08-02')).toBe(false);
    expect(monthFullyCovered('2026-08', '2026-08-01T00:00:00.001Z')).toBe(false);
  });

  it('an upper bound covers the month when it reaches its last instant (prefixes are inclusive)', () => {
    expect(monthFullyCovered('2026-09', undefined, '2026-09-30')).toBe(true);
    expect(monthFullyCovered('2026-09', undefined, '2026-09')).toBe(true);
    expect(monthFullyCovered('2026-09', undefined, '2026-09-30T23:59:59.999Z')).toBe(true);
    expect(monthFullyCovered('2026-09', undefined, '2026-10-01')).toBe(true);
    expect(monthFullyCovered('2026-09', undefined, '2026-09-29')).toBe(false);
    expect(monthFullyCovered('2026-02', undefined, '2026-02-28')).toBe(true);
    expect(monthFullyCovered('2024-02', undefined, '2024-02-28')).toBe(false);
  });
});

describe('CallsService — counting a new call', () => {
  function make(created: { created: boolean; becameInternal: boolean; startedAt?: string } | undefined) {
    const repo = {
      getBySid: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue(created),
    };
    const counters = { bump: jest.fn().mockResolvedValue(undefined) };
    const service = new CallsService(
      repo as never,
      undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      undefined, counters as never,
    );
    return { service, counters };
  }
  const flush = () => new Promise((r) => setImmediate(r));

  it('a first write ADDs one to the month the call started in', async () => {
    const { service, counters } = make({ created: true, becameInternal: false });

    await service.applyLifecycle({ callSid: 'CA1', startedAt: '2026-08-31T23:59:00.000Z', status: 'ringing' });
    await flush();

    expect(counters.bump).toHaveBeenCalledWith('2026-08', 1);
  });

  it('a later write counts nothing', async () => {
    const { service, counters } = make({ created: false, becameInternal: false });

    await service.applyLifecycle({ callSid: 'CA1', status: 'completed' });
    await flush();

    expect(counters.bump).not.toHaveBeenCalled();
  });

  it('a receiving internal leg is not a call of the log — never counted', async () => {
    const { service, counters } = make({ created: true, becameInternal: false });

    await service.applyLifecycle({ callSid: 'CA2', startedAt: '2026-08-05T10:00:00.000Z', internalLegOf: 'CA1' });
    await flush();

    expect(counters.bump).not.toHaveBeenCalled();
  });

  it('a counted row that turns out to be an internal leg is taken back off its month', async () => {
    const { service, counters } = make({ created: false, becameInternal: true, startedAt: '2026-07-31T23:59:00.000Z' });

    await service.applyLifecycle({ callSid: 'CA2', internalLegOf: 'CA1' });
    await flush();

    expect(counters.bump).toHaveBeenCalledWith('2026-07', -1);
  });

  it('a counter that cannot be written never fails the call write', async () => {
    const { service, counters } = make({ created: true, becameInternal: false });
    counters.bump.mockRejectedValueOnce(new Error('throttled'));

    await expect(
      service.applyLifecycle({ callSid: 'CA1', startedAt: '2026-08-05T10:00:00.000Z' }),
    ).resolves.toBeTruthy();
  });
});

describe('CallsService.count — counters first', () => {
  function make(opts: { ready?: boolean; months?: Map<string, number>; walk?: number } = {}) {
    const repo = { count: jest.fn().mockResolvedValue({ total: opts.walk ?? 7, atLeast: false }) };
    const counters = {
      ready: jest.fn().mockResolvedValue(opts.ready ?? true),
      months: jest.fn().mockResolvedValue(opts.months ?? new Map()),
    };
    const service = new CallsService(
      repo as never,
      undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      undefined, counters as never,
    );
    return { service, repo, counters };
  }

  it('an unfiltered count is the sum of the month counters — no walk', async () => {
    const { service, repo, counters } = make({ months: new Map([['2026-07', 10], ['2026-08', 5]]) });

    await expect(service.count({})).resolves.toEqual({ total: 15, atLeast: false });
    expect(repo.count).not.toHaveBeenCalled();
    expect(counters.months.mock.calls[0][0]).toBe('2015-01');
  });

  it('a date window: whole months from the counters, the edge months walked', async () => {
    const { service, repo } = make({ months: new Map([['2026-07', 100], ['2026-08', 200], ['2026-09', 300]]), walk: 3 });

    const out = await service.count({ dateFrom: '2026-07-15', dateTo: '2026-09-30' });

    // July is an edge (from the 15th) → walked; August and September whole.
    expect(out).toEqual({ total: 3 + 200 + 300, atLeast: false });
    expect(repo.count).toHaveBeenCalledTimes(1);
    expect(repo.count.mock.calls[0][1]).toEqual({ months: ['2026-07'] });
    expect(repo.count.mock.calls[0][0]).toEqual({ dateFrom: '2026-07-15', dateTo: '2026-09-30' });
  });

  it('any other filter walks the log as before', async () => {
    const { service, repo, counters } = make();

    await service.count({ status: 'completed' });

    expect(counters.ready).not.toHaveBeenCalled();
    expect(repo.count).toHaveBeenCalledWith({ status: 'completed' });
  });

  it('counters not yet recounted → the walk answers', async () => {
    const { service, repo } = make({ ready: false });

    await service.count({});

    expect(repo.count).toHaveBeenCalledWith({});
  });
});

describe('recount:calls — the plan', () => {
  it('sets every month whose counter differs from the log, including stray ones to 0', () => {
    const plan = planRecount(
      new Map([['2026-07', 10], ['2026-08', 5]]),
      new Map([['2026-07', 10], ['2026-08', 4], ['2026-06', 2]]),
    );

    expect(plan).toEqual([
      { month: '2026-06', from: 2, to: 0 },
      { month: '2026-08', from: 4, to: 5 },
    ]);
  });
});

describe('the count and the cards walk months in parallel', () => {
  function gated() {
    let inFlight = 0;
    let peak = 0;
    const client = {
      send: jest.fn(async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight -= 1;
        return { Count: 1, Items: [{ direction: 'inbound' }] };
      }),
    };
    return { repo: new CallsRepository({ client } as unknown as DynamoDbService), peak: () => peak, client };
  }
  const year = { dateFrom: '2026-01-01T00:00:00.000Z', dateTo: '2026-12-31T23:59:59.999Z', status: 'completed' };

  it('count: six months at a time, every month counted once', async () => {
    const { repo, peak, client } = gated();

    await expect(repo.count(year)).resolves.toEqual({ total: 12, atLeast: false });
    expect(peak()).toBe(6);
    expect(client.send).toHaveBeenCalledTimes(12);
  });

  it('walkSelection: six months at a time, every row handed over', async () => {
    const { repo, peak } = gated();
    const rows: unknown[] = [];

    await expect(repo.walkSelection(year, ['direction'], (r) => rows.push(r))).resolves.toEqual({ atLeast: false });
    expect(rows).toHaveLength(12);
    expect(peak()).toBe(6);
  });

  it('count with `months` reads only those partitions', async () => {
    const { repo, client } = gated();

    await repo.count(year, { months: ['2026-03'] });

    expect(client.send).toHaveBeenCalledTimes(1);
    expect((client.send.mock.calls[0] as unknown as [{ input: Record<string, any> }])[0].input.ExpressionAttributeValues[':allPk']).toBe('CALL#2026-03');
  });
});
