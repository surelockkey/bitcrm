import { type JwtUser } from '@bitcrm/types';
import { CallFinalizer } from '../../src/calls/call-finalizer';
import { CallNamer } from '../../src/calls/call-namer';
import { RecentCallsStore, RECENT_CALLS_KEY } from '../../src/calls/recent-calls.store';
import { CallsController } from '../../src/calls/calls.controller';
import { CallsService } from '../../src/calls/calls.service';
import { type CallRecord } from '../../src/calls/calls.repository';
import { FakeRedisKv } from './helpers/fake-redis-kv';

/**
 * Reads never write. `GET /calls` used to freeze each finished call's parties
 * and stamp its searchable names from the read path, one background DynamoDB
 * write per row. That work now happens once, on the write path, when a call
 * ends (CallFinalizer) — which also pushes the call onto the dashboard's
 * "Recent Calls" list in Redis.
 */

const ended = (over: Partial<CallRecord> = {}): CallRecord => ({
  callSid: 'CA1',
  direction: 'inbound',
  status: 'completed',
  from: '+14045551234',
  to: '+15412830739',
  answeredAt: '2026-08-05T10:00:05.000Z',
  participants: [{ userId: 'u9', role: 'answered', at: '2026-08-05T10:00:05.000Z' }],
  startedAt: '2026-08-05T10:00:00.000Z',
  updatedAt: '2026-08-05T10:01:00.000Z',
  ...over,
});

function lookups(opts: { users?: Record<string, unknown>; contacts?: Record<string, unknown> } = {}) {
  return {
    userNames: { resolve: jest.fn().mockResolvedValue(opts.users ?? { u9: { name: 'Tamir Levi', roleId: 'r-disp' } }) },
    contacts: {
      resolve: jest.fn().mockResolvedValue(opts.contacts ?? { '+14045551234': { kind: 'contact', id: 'c1', name: 'Jane Roe' } }),
      resolveRefs: jest.fn().mockResolvedValue({}),
    },
    userPhones: { resolve: jest.fn().mockResolvedValue({}) },
  };
}

describe('CallNamer', () => {
  it('names a finished call and says what to freeze and stamp — without writing anything', async () => {
    const l = lookups();
    const namer = new CallNamer(l.userNames as never, l.contacts as never, l.userPhones as never);

    const [named] = await namer.name([ended()]);

    expect(named.call.fromParty).toMatchObject({ kind: 'contact', id: 'c1', name: 'Jane Roe' });
    expect(named.freeze).toEqual({ from: { kind: 'contact', id: 'c1' }, to: { kind: 'user', id: 'u9' } });
    expect(named.searchText).toBe('jane roe\ntamir levi');
  });

  it('a live call: nothing to freeze or stamp', async () => {
    const l = lookups();
    const [named] = await new CallNamer(l.userNames as never, l.contacts as never, l.userPhones as never).name([
      ended({ status: 'in-progress' }),
    ]);

    expect(named.freeze).toBeUndefined();
    expect(named.searchText).toBeUndefined();
  });

  it('a half-answered lookup yields no search text — a user-service blip is not a rename', async () => {
    const l = lookups({ users: {} });
    const [named] = await new CallNamer(l.userNames as never, l.contacts as never, l.userPhones as never).name([ended()]);

    expect(named.searchText).toBeUndefined();
  });

  it('never returns the stored search names or the job total', async () => {
    const l = lookups();
    const [named] = await new CallNamer(l.userNames as never, l.contacts as never, l.userPhones as never).name([
      ended({ partyNames: 'x', dealId: 'd1', dealTotal: 500, dealTotalAt: '2026-08-05T10:00:00.000Z' }),
    ]);

    expect(named.call).not.toHaveProperty('partyNames');
    expect(named.call).not.toHaveProperty('dealTotal');
    expect(named.call).not.toHaveProperty('dealTotalAt');
    expect(named.call.dealId).toBe('d1');
  });
});

describe('RecentCallsStore', () => {
  it('keeps the last twenty finished calls, newest first', async () => {
    const redis = new FakeRedisKv();
    const store = new RecentCallsStore({ client: redis } as never);

    for (let i = 0; i < 25; i++) {
      await store.push({ ...ended(), callSid: `CA${i}`, startedAt: `2026-08-05T10:${String(i).padStart(2, '0')}:00.000Z` });
    }

    expect(redis.lists.get(RECENT_CALLS_KEY)).toHaveLength(20);
    const four = await store.read(4);
    expect(four.map((c) => c.callSid)).toEqual(['CA24', 'CA23', 'CA22', 'CA21']);
  });

  it('a call pushed twice (two tasks) is listed once, newest by start', async () => {
    const redis = new FakeRedisKv();
    const store = new RecentCallsStore({ client: redis } as never);
    await store.push({ ...ended(), callSid: 'CA1', startedAt: '2026-08-05T10:00:00.000Z' });
    await store.push({ ...ended(), callSid: 'CA2', startedAt: '2026-08-05T09:00:00.000Z' });
    await store.push({ ...ended(), callSid: 'CA1', startedAt: '2026-08-05T10:00:00.000Z' });

    expect((await store.read(4)).map((c) => c.callSid)).toEqual(['CA1', 'CA2']);
  });

  it('Redis down: push is a no-op and read is empty', async () => {
    const redis = new FakeRedisKv();
    redis.fail = true;
    const store = new RecentCallsStore({ client: redis } as never);

    await expect(store.push(ended())).resolves.toBeUndefined();
    await expect(store.read(4)).resolves.toEqual([]);
  });

  it('without Redis there is no list', async () => {
    const store = new RecentCallsStore(undefined);
    await store.push(ended());
    await expect(store.read(4)).resolves.toEqual([]);
  });
});

describe('CallFinalizer', () => {
  function make(record: CallRecord | null, opts: Parameters<typeof lookups>[0] = {}) {
    const repo = {
      getBySid: jest.fn().mockResolvedValue(record),
      setParties: jest.fn().mockResolvedValue(undefined),
      setPartyNames: jest.fn().mockResolvedValue(undefined),
    };
    const l = lookups(opts);
    const recent = { push: jest.fn().mockResolvedValue(undefined) };
    const finalizer = new CallFinalizer(
      repo as never,
      l.userNames as never,
      l.contacts as never,
      l.userPhones as never,
      recent as never,
    );
    return { finalizer, repo, recent };
  }

  it('freezes the parties, stamps the search names and lists the call', async () => {
    const { finalizer, repo, recent } = make(ended());

    await finalizer.finalize('CA1');

    expect(repo.setParties).toHaveBeenCalledWith(
      'CA1',
      { from: { kind: 'contact', id: 'c1' }, to: { kind: 'user', id: 'u9' } },
      '2026-08-05T10:00:00.000Z',
      'auto',
    );
    expect(repo.setPartyNames).toHaveBeenCalledWith('CA1', 'jane roe\ntamir levi');
    expect(recent.push).toHaveBeenCalledWith(expect.objectContaining({ callSid: 'CA1', fromParty: expect.anything() }));
  });

  it('names already right are not rewritten', async () => {
    const { finalizer, repo } = make(ended({ partyNames: 'jane roe\ntamir levi' }));

    await finalizer.finalize('CA1');

    expect(repo.setPartyNames).not.toHaveBeenCalled();
  });

  it('a call still going is left alone', async () => {
    const { finalizer, repo, recent } = make(ended({ status: 'in-progress' }));

    await finalizer.finalize('CA1');

    expect(repo.setParties).not.toHaveBeenCalled();
    expect(recent.push).not.toHaveBeenCalled();
  });

  it('the hidden receiving leg of an internal call is never listed', async () => {
    const { finalizer, recent } = make(ended({ internalLegOf: 'CA0' }));

    await finalizer.finalize('CA1');

    expect(recent.push).not.toHaveBeenCalled();
  });

  it('schedule waits a few seconds, so the settled record is what gets frozen', async () => {
    jest.useFakeTimers();
    try {
      const { finalizer, repo } = make(ended());
      finalizer.schedule('CA1');
      expect(repo.getBySid).not.toHaveBeenCalled();
      jest.advanceTimersByTime(5_000);
      expect(repo.getBySid).toHaveBeenCalledWith('CA1');
    } finally {
      jest.useRealTimers();
    }
  });

  it('restampNames rewrites the search names after a manual party change', async () => {
    const { finalizer, repo } = make(
      ended({ fromPartyKind: 'contact', fromPartyId: 'c2', toPartyKind: 'user', toPartyId: 'u9', partyNames: 'jane roe\ntamir levi' }),
    );
    // c2 resolves by id.
    (finalizer as unknown as { namer: { contacts: { resolveRefs: jest.Mock } } }).namer.contacts.resolveRefs.mockResolvedValue({
      'contact:c2': 'John Doe',
    });

    await finalizer.restampNames('CA1');

    expect(repo.setPartyNames).toHaveBeenCalledWith('CA1', 'john doe\ntamir levi');
    expect(repo.setParties).not.toHaveBeenCalled();
  });

  it('schedule never throws, whatever fails', async () => {
    const { finalizer, repo } = make(ended());
    repo.getBySid.mockRejectedValueOnce(new Error('dynamo down'));

    expect(() => finalizer.schedule('CA1', 0)).not.toThrow();
    await new Promise((r) => setImmediate(r));
    expect(repo.getBySid).toHaveBeenCalledWith('CA1');
  });
});

describe('CallsService — a call ending is finalized once', () => {
  function make(existing: Partial<CallRecord> | null) {
    const repo = {
      getBySid: jest.fn().mockResolvedValue(existing),
      upsert: jest.fn().mockResolvedValue({ created: false, becameInternal: false }),
    };
    const finalizer = { schedule: jest.fn() };
    const recordings = { schedule: jest.fn() };
    const service = new CallsService(
      repo as never,
      undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      finalizer as never, undefined, recordings as never,
    );
    return { service, finalizer, recordings };
  }

  it('the first terminal status schedules the finalizer', async () => {
    const { service, finalizer } = make({ callSid: 'CA1', status: 'in-progress', startedAt: 's', updatedAt: 'u' });

    await service.applyLifecycle({ callSid: 'CA1', status: 'completed', endedAt: '2026-08-05T10:01:00.000Z' });

    expect(finalizer.schedule).toHaveBeenCalledWith('CA1');
  });

  it('a late duplicate terminal callback does not', async () => {
    const { service, finalizer } = make({ callSid: 'CA1', status: 'completed', startedAt: 's', updatedAt: 'u' });

    await service.applyLifecycle({ callSid: 'CA1', status: 'completed' });

    expect(finalizer.schedule).not.toHaveBeenCalled();
  });

  it('a recording arriving for the first time is handed to the archiver', async () => {
    const { service, recordings } = make({ callSid: 'CA1', status: 'completed', startedAt: 's', updatedAt: 'u' });

    await service.applyLifecycle({ callSid: 'CA1', recordingSid: 'RE1', recordingDurationSeconds: 30 });

    expect(recordings.schedule).toHaveBeenCalledWith('CA1', 'RE1');
  });

  it('a manual party change restamps the search names', async () => {
    const repo = { setParties: jest.fn().mockResolvedValue(undefined) };
    const finalizer = { restampNames: jest.fn().mockResolvedValue(undefined) };
    const service = new CallsService(
      repo as never,
      undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      finalizer as never,
    );

    await service.setPartiesManually('CA1', { from: { kind: 'contact', id: 'c2' } }, 's');

    expect(finalizer.restampNames).toHaveBeenCalledWith('CA1');
  });
});

describe('CallsController — the read path never writes', () => {
  function make(rows: CallRecord[], recent: CallRecord[] = []) {
    const calls = {
      list: jest.fn().mockResolvedValue({ items: rows }),
      freezeParties: jest.fn(),
      stampPartyNames: jest.fn(),
    } as unknown as CallsService;
    const l = lookups();
    const permissions = { maySeeClientNumbers: jest.fn().mockResolvedValue(true) };
    const store = { read: jest.fn().mockResolvedValue(recent) };
    const none = {} as never;
    const controller = new CallsController(
      calls,
      none,
      none,
      l.userNames as never,
      l.contacts as never,
      l.userPhones as never,
      none,
      permissions as never,
      none,
      none,
      {} as never,
      undefined,
      undefined,
      store as never,
    );
    return { controller, calls, store };
  }

  it('listing finished, unfrozen, unstamped calls writes nothing', async () => {
    const { controller, calls } = make([ended(), ended({ callSid: 'CA2' })]);

    await controller.list({}, { id: 'x' } as JwtUser);
    await new Promise((r) => setImmediate(r));

    const spy = calls as unknown as { freezeParties: jest.Mock; stampPartyNames: jest.Mock };
    expect(spy.freezeParties).not.toHaveBeenCalled();
    expect(spy.stampPartyNames).not.toHaveBeenCalled();
  });

  it('"Recent Calls" is served from the Redis list when it holds four', async () => {
    const four = ['CA1', 'CA2', 'CA3', 'CA4'].map((sid) => ({ ...ended(), callSid: sid }));
    const { controller, calls } = make([], four);

    const res = await controller.recentForDashboard({ id: 'x' } as JwtUser);

    expect(res.data.map((c: CallRecord) => c.callSid)).toEqual(['CA1', 'CA2', 'CA3', 'CA4']);
    expect(calls.list).not.toHaveBeenCalled();
  });

  it('an empty (or short) list falls back to the log', async () => {
    const { controller, calls } = make([ended()], [ended()]);

    const res = await controller.recentForDashboard({ id: 'x' } as JwtUser);

    expect(calls.list).toHaveBeenCalledWith({}, undefined, 4);
    expect(res.data).toHaveLength(1);
  });

  it('the cached rows are masked for a viewer without the numbers grant', async () => {
    const four = ['CA1', 'CA2', 'CA3', 'CA4'].map((sid) => ({ ...ended(), callSid: sid }));
    const { controller } = make([], four);
    (controller as unknown as { permissions: { maySeeClientNumbers: jest.Mock } }).permissions.maySeeClientNumbers.mockResolvedValue(false);

    const res = await controller.recentForDashboard({ id: 'x' } as JwtUser);

    expect(JSON.stringify(res.data)).not.toContain('+14045551234');
  });
});
