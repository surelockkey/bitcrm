import { RedisBatchCache } from '../../src/common/redis-batch-cache';
import { ContactLookupService } from '../../src/common/contact-lookup.service';
import { UserPhoneLookupService } from '../../src/common/user-phone-lookup.service';
import { UserNamesService } from '../../src/common/user-names.service';
import { UserDirectoryService } from '../../src/common/user-directory.service';
import { FakeRedisKv } from './helpers/fake-redis-kv';

/**
 * Caller names were cached per process (20 s for an unknown number): every
 * task asked the CRM and user-service for the same numbers, and every deploy
 * started cold. They now live in Redis, shared by the tasks — known names ten
 * minutes, unknown numbers five — with a ten-second in-process layer in front
 * and one load per key at a time. A contact created or edited invalidates its
 * numbers (contact-events), so "Add client" still shows through at once.
 */

const MIN = 60_000;

function clock() {
  let t = 1_000_000;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe('RedisBatchCache', () => {
  function make(given?: FakeRedisKv | null, c = clock()) {
    const redis = given === undefined ? new FakeRedisKv() : given;
    const cache = new RedisBatchCache<string>(
      redis ? ({ client: redis } as never) : undefined,
      'tel:test',
      { hitTtlMs: 10 * MIN, missTtlMs: 5 * MIN, l1TtlMs: 10_000 },
      c.now,
    );
    return { cache, redis: redis!, c };
  }

  it('loads what nobody has, keeps hits and misses in Redis with their own TTLs', async () => {
    const { cache, redis } = make();
    const load = jest.fn(async (keys: string[]) => new Map(keys.map((k) => [k, k === 'a' ? 'Alice' : null])));

    const out = await cache.getMany(['a', 'b'], load);

    expect(out).toEqual(new Map([['a', 'Alice']]));
    expect(load).toHaveBeenCalledWith(['a', 'b']);
    expect(JSON.parse(redis.strings.get('tel:test:a')!)).toEqual({ v: 'Alice' });
    expect(JSON.parse(redis.strings.get('tel:test:b')!)).toEqual({ v: null });
    expect(redis.ttls.get('tel:test:a')).toEqual(['PX', 10 * MIN]);
    expect(redis.ttls.get('tel:test:b')).toEqual(['PX', 5 * MIN]);
  });

  it('another task reads them from Redis — no load', async () => {
    const redis = new FakeRedisKv();
    await make(redis).cache.getMany(['a', 'b'], async (keys) => new Map(keys.map((k) => [k, k === 'a' ? 'Alice' : null])));

    const load = jest.fn();
    const out = await make(redis).cache.getMany(['a', 'b'], load);

    expect(out).toEqual(new Map([['a', 'Alice']]));
    expect(load).not.toHaveBeenCalled();
  });

  it('the in-process layer answers a burst without Redis, for ten seconds', async () => {
    const { cache, redis, c } = make();
    await cache.getMany(['a'], async () => new Map([['a', 'Alice']]));
    redis.calls.length = 0;

    await cache.getMany(['a'], jest.fn());
    expect(redis.calls).toEqual([]);

    c.advance(10_001);
    await cache.getMany(['a'], jest.fn());
    expect(redis.calls).toEqual(['mget']);
  });

  it('single-flight: a key being loaded is waited on, not loaded twice', async () => {
    const { cache } = make();
    let release!: () => void;
    const load = jest.fn(
      (keys: string[]) => new Promise<Map<string, string | null>>((r) => (release = () => r(new Map(keys.map((k) => [k, `v-${k}`]))))),
    );

    const first = cache.getMany(['a', 'b'], load);
    await new Promise((r) => setImmediate(r));
    const second = cache.getMany(['b'], load);
    release();

    expect(await first).toEqual(new Map([['a', 'v-a'], ['b', 'v-b']]));
    expect(await second).toEqual(new Map([['b', 'v-b']]));
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('a key the loader left out (upstream failed) is not cached', async () => {
    const { cache, redis } = make();
    await cache.getMany(['a'], async () => new Map());
    expect(redis.strings.has('tel:test:a')).toBe(false);

    const load = jest.fn(async () => new Map([['a', 'Alice']]));
    expect(await cache.getMany(['a'], load)).toEqual(new Map([['a', 'Alice']]));
    expect(load).toHaveBeenCalled();
  });

  it('a loader that throws is an empty answer, not an error', async () => {
    const { cache } = make();
    await expect(cache.getMany(['a'], async () => Promise.reject(new Error('down')))).resolves.toEqual(new Map());
  });

  it('Redis down → the in-process layer and the loader, never an error', async () => {
    const redis = new FakeRedisKv();
    redis.fail = true;
    const { cache } = make(redis);
    const load = jest.fn(async () => new Map([['a', 'Alice']]));

    expect(await cache.getMany(['a'], load)).toEqual(new Map([['a', 'Alice']]));
    expect(await cache.getMany(['a'], load)).toEqual(new Map([['a', 'Alice']]));
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('without Redis the in-process layer keeps entries their full TTL', async () => {
    const c = clock();
    const { cache } = make(null, c);
    const load = jest.fn(async (keys: string[]) => new Map(keys.map((k) => [k, null])));

    await cache.getMany(['a'], load);
    c.advance(5 * MIN - 1);
    await cache.getMany(['a'], load);
    expect(load).toHaveBeenCalledTimes(1);
    c.advance(2);
    await cache.getMany(['a'], load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('invalidate forgets a key in this process and in Redis', async () => {
    const { cache, redis } = make();
    await cache.getMany(['a'], async () => new Map([['a', null]]));

    await cache.invalidate(['a']);

    expect(redis.strings.has('tel:test:a')).toBe(false);
    const load = jest.fn(async () => new Map([['a', 'Alice']]));
    expect(await cache.getMany(['a'], load)).toEqual(new Map([['a', 'Alice']]));
  });
});

describe('the caller-name lookups share Redis', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  const crm = (data: Record<string, unknown>) =>
    jest.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, data }) });

  it('ContactLookupService: a second task gets the name from Redis', async () => {
    const redis = new FakeRedisKv();
    global.fetch = crm({ '+14045551234': { kind: 'contact', id: 'c1', firstName: 'Jane', lastName: 'Roe' } }) as never;
    await new ContactLookupService({ client: redis } as never).resolve(['+14045551234']);

    global.fetch = jest.fn() as never;
    const out = await new ContactLookupService({ client: redis } as never).resolve(['+14045551234']);

    expect(out['+14045551234']?.name).toBe('Jane Roe');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('ContactLookupService: a number nobody owns is remembered for five minutes', async () => {
    const redis = new FakeRedisKv();
    global.fetch = crm({}) as never;
    await new ContactLookupService({ client: redis } as never).resolve(['+14045550000']);

    const [key] = [...redis.strings.keys()].filter((k) => k.includes('+14045550000'));
    expect(redis.ttls.get(key)).toEqual(['PX', 5 * MIN]);
  });

  it('ContactLookupService.forgetContact drops its numbers and its name everywhere', async () => {
    const redis = new FakeRedisKv();
    global.fetch = crm({}) as never;
    const service = new ContactLookupService({ client: redis } as never);
    await service.resolve(['+14045550000']);
    // The contact now exists and owns the number.
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { phones: ['+14045550000'], firstName: 'Jane' } }) })
      .mockResolvedValue({
        ok: true,
        json: async () => ({ data: { '+14045550000': { kind: 'contact', id: 'c9', firstName: 'Jane' } } }),
      }) as never;

    await service.forgetContact('c9');
    const out = await new ContactLookupService({ client: redis } as never).resolve(['+14045550000']);

    expect(out['+14045550000']).toMatchObject({ id: 'c9', name: 'Jane' });
  });

  it('UserPhoneLookupService: shared through Redis too', async () => {
    const redis = new FakeRedisKv();
    global.fetch = crm({ '+15550001111': { id: 'u1', firstName: 'Tamir' } }) as never;
    await new UserPhoneLookupService({ client: redis } as never).resolve(['+15550001111']);

    global.fetch = jest.fn() as never;
    const out = await new UserPhoneLookupService({ client: redis } as never).resolve(['+15550001111']);
    expect(out['+15550001111']).toEqual({ id: 'u1', name: 'Tamir', roleId: undefined });
  });

  it('UserNamesService: shared through Redis, ten minutes', async () => {
    const redis = new FakeRedisKv();
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { firstName: 'Tamir', lastName: 'Levi' } }) }) as never;
    await new UserNamesService({ client: redis } as never).resolve(['u1']);

    global.fetch = jest.fn() as never;
    const out = await new UserNamesService({ client: redis } as never).resolve(['u1']);
    expect(out.u1).toEqual({ name: 'Tamir Levi', roleId: undefined });
    const [key] = [...redis.strings.keys()];
    expect(redis.ttls.get(key)).toEqual(['PX', 10 * MIN]);
  });

  it('UserNamesService: a user-service failure is not cached', async () => {
    const redis = new FakeRedisKv();
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 503 }) as never;
    await new UserNamesService({ client: redis } as never).resolve(['u1']);
    expect(redis.strings.size).toBe(0);
  });
});

describe('UserDirectoryService — Redis, stale-while-revalidate', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  const listing = (names: string[]) =>
    jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { items: names.map((n, i) => ({ id: `u${i}`, firstName: n })) } }),
    });

  it('one task loads, the next reads Redis', async () => {
    const redis = new FakeRedisKv();
    global.fetch = listing(['Ann']) as never;
    expect((await new UserDirectoryService({ client: redis } as never).list()).map((u) => u.name)).toEqual(['Ann']);

    global.fetch = jest.fn() as never;
    expect((await new UserDirectoryService({ client: redis } as never).list()).map((u) => u.name)).toEqual(['Ann']);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('user-service down with nothing cached → an empty list, never an error', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 503 }) as never;
    await expect(new UserDirectoryService({ client: new FakeRedisKv() } as never).list()).resolves.toEqual([]);
  });

  it('a failed reload serves the list already held', async () => {
    const redis = new FakeRedisKv();
    global.fetch = listing(['Ann']) as never;
    await new UserDirectoryService({ client: redis } as never).list();
    // Age the entry past stale so the next read must reload.
    for (const [k, v] of redis.strings) {
      if (!k.endsWith(':gen')) redis.strings.set(k, JSON.stringify({ ...JSON.parse(v), at: 0 }));
    }
    global.fetch = jest.fn().mockRejectedValue(new Error('down')) as never;

    expect((await new UserDirectoryService({ client: redis } as never).list()).map((u) => u.name)).toEqual(['Ann']);
  });

  it('find() is a lookup in the same list', async () => {
    global.fetch = listing(['Ann', 'Bob']) as never;
    await expect(new UserDirectoryService(undefined).find('u1')).resolves.toMatchObject({ name: 'Bob' });
  });
});
