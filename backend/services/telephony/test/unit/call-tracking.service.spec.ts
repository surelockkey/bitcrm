import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { CallTrackingRepository, walkSlices } from 'src/calls/tracking/call-tracking.repository';
import { CallTrackingService } from 'src/calls/tracking/call-tracking.service';
import { CallTrackingController } from 'src/calls/tracking/call-tracking.controller';
import { CallTrackingSnapshotScheduler } from 'src/calls/tracking/call-tracking.scheduler';
import { DealTotalsClient } from 'src/common/deal-totals.client';
import type { TrackedCall } from 'src/calls/tracking/call-tracking';

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
  dealId: 'd1',
  ...over,
});

describe('Call Tracking — slicing the window over the month partitions', () => {
  it('cuts a window into day slices that never overlap', () => {
    const slices = walkSlices('2026-09-01T04:00:00.000Z', '2026-09-04T04:00:00.000Z');
    expect(slices).toHaveLength(3);
    expect(slices[0]).toEqual({
      pk: 'CALL#2026-09',
      lo: '2026-09-01T04:00:00.000Z',
      hi: '2026-09-02T03:59:59.999Z￿',
    });
    expect(slices[1].lo).toBe('2026-09-02T04:00:00.000Z');
  });

  it('splits a slice at the start of a UTC month, so each reads one partition', () => {
    // Sep 30 in New York runs into Oct 1 UTC.
    const slices = walkSlices('2026-09-30T04:00:00.000Z', '2026-10-01T04:00:00.000Z');
    expect(slices.map((s) => [s.pk, s.lo])).toEqual([
      ['CALL#2026-09', '2026-09-30T04:00:00.000Z'],
      ['CALL#2026-10', '2026-10-01T00:00:00.000Z'],
    ]);
  });
});

describe('CallTrackingRepository — the walk', () => {
  it('queries the log index per slice, inbound only, projected, and follows the pages', async () => {
    const send = jest.fn(async (cmd: { input: Record<string, any> }) => {
      if (!cmd.input.ExclusiveStartKey && cmd.input.ExpressionAttributeValues[':lo'].startsWith('2026-09-01')) {
        return { Items: [inbound()], LastEvaluatedKey: { PK: 'x' } };
      }
      return { Items: [inbound({ callSid: 'CA2' })] };
    });
    const repo = new CallTrackingRepository({ client: { send } } as never);
    const seen: TrackedCall[] = [];

    const res = await repo.walk(
      { start: '2026-09-01T04:00:00.000Z', end: '2026-09-03T04:00:00.000Z' },
      (c) => seen.push(c),
    );

    expect(res).toEqual({ atLeast: false, queries: 3 });
    expect(seen).toHaveLength(3);
    const input = send.mock.calls[0][0].input;
    expect(input.IndexName).toBe('AllCallsIndex');
    expect(input.KeyConditionExpression).toBe('GSI2PK = :pk AND GSI2SK BETWEEN :lo AND :hi');
    expect(input.FilterExpression).toContain('attribute_not_exists(internalLegOf)');
    expect(input.ExpressionAttributeValues[':inbound']).toBe('inbound');
    expect(Object.values(input.ExpressionAttributeNames)).toEqual(
      expect.arrayContaining(['dialCallStatus', 'workizJobId', 'dealId', 'flowId', 'from']),
    );
  });

  it('stops on its read budget and says the numbers are a floor', async () => {
    const send = jest.fn(async () => ({ Items: [inbound()], LastEvaluatedKey: { PK: 'more' } }));
    const repo = new CallTrackingRepository({ client: { send } } as never);

    const res = await repo.walk(
      { start: '2026-09-01T04:00:00.000Z', end: '2026-09-02T04:00:00.000Z' },
      () => undefined,
      { budget: 5 },
    );

    expect(res).toEqual({ atLeast: true, queries: 5 });
  });
});

function service(over: { calls?: TrackedCall[]; totals?: () => Promise<Map<string, number>>; atLeast?: boolean } = {}) {
  const store = new Map<string, string>();
  const redis = {
    client: {
      get: jest.fn(async (k: string) => store.get(k) ?? null),
      set: jest.fn(async (k: string, v: string) => void store.set(k, v)),
    },
  };
  const repo = {
    walk: jest.fn(async (_w: unknown, onCall: (c: TrackedCall) => void) => {
      for (const c of over.calls ?? [inbound()]) onCall(c);
      return { atLeast: !!over.atLeast, queries: 1 };
    }),
  };
  const deals = { totals: jest.fn(over.totals ?? (async () => new Map([['d1', 120.5]]))) };
  const flows = { list: jest.fn(async () => [{ id: 'flow-ct', name: '(2-CT-O) SURE CT ORGANIC', numbers: ['+12034036303'] }]) };
  const numbers = { list: jest.fn(async () => [{ phoneNumber: '+18889770000' }]) };
  const svc = new CallTrackingService(repo as never, deals as never, flows as never, numbers as never, redis as never);
  return { svc, repo, deals, redis, store };
}

const NOW = new Date('2026-09-30T16:00:00.000Z');

describe('CallTrackingService', () => {
  it('builds the report: rows, cards, graph and revenue from deal totals', async () => {
    const { svc } = service();

    const report = await svc.report(
      { from: '2026-09-01', to: '2026-09-27', groupBy: 'flows', graphBy: 'day' },
      { withRevenue: true, now: NOW },
    );

    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]).toMatchObject({ name: '(2-CT-O) SURE CT ORGANIC', calls: 1, jobs: 1, revenue: 120.5 });
    expect(report.cards).toMatchObject({ incomingCalls: 1, topFlow: '(2-CT-O) SURE CT ORGANIC', revenue: 120.5 });
    expect(report.graph.buckets).toHaveLength(27);
  });

  it('serves the number view with every known number', async () => {
    const { svc } = service();
    const report = await svc.report(
      { from: '2026-09-01', to: '2026-09-27', groupBy: 'numbers' },
      { withRevenue: false, now: NOW },
    );
    expect(report.rows.map((r) => r.number)).toEqual(['+12034036303', '+18889770000']);
    expect(report.cards.topFlow).toBeNull();
    expect(report.rows[0]).not.toHaveProperty('revenue');
    expect(report.graphBy).toBe('hour');
  });

  it('keeps a closed window until the next night and reuses it for the other grouping', async () => {
    const { svc, repo, redis } = service();
    await svc.report({ from: '2026-09-01', to: '2026-09-27' }, { withRevenue: true, now: NOW });
    await svc.report({ from: '2026-09-01', to: '2026-09-27', groupBy: 'numbers' }, { withRevenue: true, now: NOW });

    expect(repo.walk).toHaveBeenCalledTimes(1);
    // v2: the graph's weeks of the month and its hundred lines (2026-10-09) —
    // a v1 snapshot (Sunday weeks, "Other flows") must never be served.
    expect(redis.client.set).toHaveBeenCalledWith(
      'calls:tracking:v2:2026-09-01:2026-09-27',
      expect.any(String),
      'EX',
      26 * 3600,
    );
  });

  it('keeps a window that includes today for five minutes', async () => {
    const { svc, redis } = service();
    await svc.report({ from: '2026-09-01', to: '2026-09-30' }, { withRevenue: true, now: NOW });
    expect(redis.client.set).toHaveBeenCalledWith(expect.any(String), expect.any(String), 'EX', 300);
  });

  it('rebuilds on refresh, and walks once for two viewers at the same moment', async () => {
    const { svc, repo } = service();
    await Promise.all([
      svc.snapshot('2026-09-01', '2026-09-27', { now: NOW }),
      svc.snapshot('2026-09-01', '2026-09-27', { now: NOW }),
    ]);
    expect(repo.walk).toHaveBeenCalledTimes(1);
    await svc.snapshot('2026-09-01', '2026-09-27', { fresh: true, now: NOW });
    expect(repo.walk).toHaveBeenCalledTimes(2);
  });

  it('serves counts but never keeps a snapshot whose job totals failed', async () => {
    const { svc, redis } = service({ totals: async () => Promise.reject(new Error('deal-service down')) });
    const report = await svc.report({ from: '2026-09-01', to: '2026-09-27' }, { withRevenue: true, now: NOW });
    expect(report.rows[0].calls).toBe(1);
    expect(report.rows[0].revenue).toBe(0);
    expect(redis.client.set).not.toHaveBeenCalled();
  });

  it('refuses a bad window, grouping or step', async () => {
    const { svc } = service();
    const opts = { withRevenue: true, now: NOW };
    await expect(svc.report({ from: '2026-9-1', to: '2026-09-27' }, opts)).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.report({ from: '2026-09-27', to: '2026-09-01' }, opts)).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.report({ from: '2025-01-01', to: '2026-09-27' }, opts)).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.report({ from: '2026-09-01', to: '2026-09-27', groupBy: 'agents' }, opts)).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.report({ from: '2026-09-01', to: '2026-09-27', graphBy: 'minute' }, opts)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('warms this month so far and the whole of last month', async () => {
    const { svc, repo } = service();
    await svc.warm(NOW);
    const windows = repo.walk.mock.calls.map(([w]) => [(w as { from: string }).from, (w as { to: string }).to]);
    expect(windows).toEqual([
      ['2026-09-01', '2026-09-30'],
      ['2026-08-01', '2026-08-31'],
    ]);
  });
});

describe('CallTrackingController — who may see it', () => {
  const perms = (p: Record<string, Record<string, boolean>>) => ({
    resolvedPermissions: { roleName: 'Dispatcher', isSystemRole: true, permissions: p, dataScope: {} },
  });

  it('refuses a role without calls.view (Workiz’s “Call Reports” restriction)', async () => {
    const tracking = { report: jest.fn() };
    const controller = new CallTrackingController(tracking as never);
    await expect(
      controller.report('2026-09-01', '2026-09-27', undefined, undefined, undefined, perms({ reports: { view: true } }) as never),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(tracking.report).not.toHaveBeenCalled();
  });

  it('asks for money only with financials.view, and passes refresh through', async () => {
    const tracking = { report: jest.fn(async () => ({})) };
    const controller = new CallTrackingController(tracking as never);

    await controller.report('2026-09-01', '2026-09-27', 'numbers', 'week', '1', perms({ calls: { view: true } }) as never);
    expect(tracking.report).toHaveBeenLastCalledWith(
      { from: '2026-09-01', to: '2026-09-27', groupBy: 'numbers', graphBy: 'week' },
      { withRevenue: false, fresh: true },
    );

    await controller.report('2026-09-01', '2026-09-27', undefined, undefined, undefined,
      perms({ calls: { view: true }, financials: { view: true } }) as never);
    expect(tracking.report).toHaveBeenLastCalledWith(expect.anything(), { withRevenue: true, fresh: false });
  });
});

describe('CallTrackingSnapshotScheduler', () => {
  it('warms once a day across instances', async () => {
    const tracking = { warm: jest.fn(async () => undefined) };
    const redis = { client: { set: jest.fn().mockResolvedValueOnce('OK').mockResolvedValueOnce(null), del: jest.fn() } };
    const scheduler = new CallTrackingSnapshotScheduler(tracking as never, redis as never);

    await expect(scheduler.runOnce(NOW)).resolves.toBe(true);
    await expect(scheduler.runOnce(NOW)).resolves.toBe(false);
    expect(tracking.warm).toHaveBeenCalledTimes(1);
    expect(redis.client.set.mock.calls[0][0]).toBe('telephony:lock:tracking-snapshot:2026-09-30');
  });
});

describe('DealTotalsClient', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('asks deal-service in pages of 1000 and merges the answers', async () => {
    const fetchMock = jest.fn(async (_url: string, init: { body: string }) => {
      const { ids } = JSON.parse(init.body) as { ids: string[] };
      return { ok: true, json: async () => ({ data: Object.fromEntries(ids.map((id) => [id, 1])) }) };
    });
    global.fetch = fetchMock as never;

    const out = await new DealTotalsClient().totals(Array.from({ length: 2500 }, (_, i) => `d${i}`));

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0][0]).toContain('/api/deals/internal/deal-totals');
    expect(out.size).toBe(2500);
  });

  it('throws when deal-service does not answer', async () => {
    global.fetch = jest.fn(async () => ({ ok: false, status: 503 })) as never;
    await expect(new DealTotalsClient().totals(['d1'])).rejects.toThrow('503');
  });
});

describe('Call Tracking — the Nest wiring', () => {
  it('resolves the controller, service and scheduler from their collaborators', async () => {
    const { Test } = await import('@nestjs/testing');
    const { DynamoDbService, RedisService } = await import('@bitcrm/shared');
    const { CallFlowsService } = await import('src/call-flows/call-flows.service');
    const { NumberSettingsRepository } = await import('src/numbers/number-settings.repository');
    const redis = { client: { get: jest.fn(async () => null), set: jest.fn(), del: jest.fn() } };
    const moduleRef = await Test.createTestingModule({
      controllers: [CallTrackingController],
      providers: [
        CallTrackingRepository,
        CallTrackingService,
        CallTrackingSnapshotScheduler,
        DealTotalsClient,
        { provide: DynamoDbService, useValue: { client: { send: jest.fn(async () => ({ Items: [] })) } } },
        { provide: RedisService, useValue: redis },
        { provide: CallFlowsService, useValue: { list: jest.fn(async () => []) } },
        { provide: NumberSettingsRepository, useValue: { list: jest.fn(async () => []) } },
      ],
    }).compile();

    const svc = moduleRef.get(CallTrackingService);
    const report = await svc.report({ from: '2026-09-01', to: '2026-09-02' }, { withRevenue: true, now: NOW });
    expect(report.rows).toEqual([]);
    expect(moduleRef.get(CallTrackingController)).toBeDefined();
    expect(moduleRef.get(CallTrackingSnapshotScheduler)).toBeDefined();
  });
});
