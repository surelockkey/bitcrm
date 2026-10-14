import { gunzipSync, gzipSync } from 'zlib';
import {
  REPORT_WINDOW_CACHE_MAX_BYTES,
  REPORT_WINDOW_TTL,
  ReportWindowCache,
  reportWindowTtlSeconds,
  shapeTag,
} from 'src/common/cache/report-window-cache';

/**
 * Спільний (між задачами) кеш читань вікон звітів: Redis, gzip, single-flight
 * у процесі. Вікно з «сьогодні» живе 5 хвилин, щойно закрите — 30 хвилин,
 * старіше — добу. Завеликі значення не пишуться взагалі.
 */
describe('ReportWindowCache', () => {
  // 2026-10-13 14:00 in New York.
  const now = new Date('2026-10-13T18:00:00.000Z');

  function fakeRedis() {
    const store = new Map<string, { value: Buffer; ttl: number }>();
    const client = {
      getBuffer: jest.fn(async (k: string) => store.get(k)?.value ?? null),
      set: jest.fn(async (k: string, v: Buffer, _ex: string, ttl: number) => {
        store.set(k, { value: v, ttl });
        return 'OK';
      }),
    };
    return { store, client, service: { client } as never };
  }

  describe('reportWindowTtlSeconds', () => {
    it('five minutes for a window that reaches today (or later), on the New York calendar', () => {
      expect(reportWindowTtlSeconds('2026-10-13', now)).toBe(REPORT_WINDOW_TTL.open);
      expect(reportWindowTtlSeconds('2026-10-31', now)).toBe(300);
      // 23:30 in New York is already the 14th in UTC — still "today" is the 13th.
      expect(reportWindowTtlSeconds('2026-10-13', new Date('2026-10-14T03:30:00.000Z'))).toBe(300);
    });

    it('thirty minutes for a window closed in the last three days — the office still closes those jobs out', () => {
      expect(reportWindowTtlSeconds('2026-10-12', now)).toBe(REPORT_WINDOW_TTL.recent);
      expect(reportWindowTtlSeconds('2026-10-10', now)).toBe(1800);
    });

    it('a day for anything older', () => {
      expect(reportWindowTtlSeconds('2026-10-09', now)).toBe(REPORT_WINDOW_TTL.closed);
      expect(REPORT_WINDOW_TTL.closed).toBe(86_400);
    });
  });

  it('shapeTag names a projection, so a deploy that changes one never reads the old shape', () => {
    expect(shapeTag(['a', 'b'])).toMatch(/^[0-9a-f]{8}$/);
    expect(shapeTag(['a', 'b'])).toBe(shapeTag(['a', 'b']));
    expect(shapeTag(['a', 'b'])).not.toBe(shapeTag(['a', 'b', 'c']));
  });

  it('a miss reads once, stores gzip under a key naming kind, window and filters', async () => {
    const redis = fakeRedis();
    const cache = new ReportWindowCache(redis.service);
    const load = jest.fn(async () => [{ id: 'd1' }, { id: 'd2' }]);

    const rows = await cache.read({ kind: 'jobs', from: '2026-09-01', to: '2026-09-30', parts: ['end', 'abcd1234'] }, load, { now });

    expect(rows).toEqual([{ id: 'd1' }, { id: 'd2' }]);
    const [key, value, ex, ttl] = redis.client.set.mock.calls[0];
    expect(key).toBe('deal:report-window:v1:jobs:2026-09-01:2026-09-30:end:abcd1234');
    expect(ex).toBe('EX');
    expect(ttl).toBe(86_400);
    expect(JSON.parse(gunzipSync(value).toString('utf8'))).toEqual([{ id: 'd1' }, { id: 'd2' }]);
  });

  it('a hit — written by any task — is served without reading DynamoDB', async () => {
    const redis = fakeRedis();
    redis.store.set('deal:report-window:v1:tax:2026-09-01:2026-09-30', { value: gzipSync(JSON.stringify([{ id: 'x' }])), ttl: 1 });
    const load = jest.fn();

    const rows = await new ReportWindowCache(redis.service).read({ kind: 'tax', from: '2026-09-01', to: '2026-09-30' }, load, { now });

    expect(rows).toEqual([{ id: 'x' }]);
    expect(load).not.toHaveBeenCalled();
  });

  it('concurrent misses for one key share one read (single-flight)', async () => {
    const redis = fakeRedis();
    const cache = new ReportWindowCache(redis.service);
    let release!: (v: unknown) => void;
    const load = jest.fn(() => new Promise((r) => (release = r)));
    const w = { kind: 'jobs', from: '2026-10-01', to: '2026-10-13' };

    const all = Promise.all([cache.read(w, load, { now }), cache.read(w, load, { now }), cache.read(w, load, { now })]);
    await new Promise((r) => setImmediate(r));
    release([{ id: 'a' }]);

    expect(await all).toEqual([[{ id: 'a' }], [{ id: 'a' }], [{ id: 'a' }]]);
    expect(load).toHaveBeenCalledTimes(1);
    expect(redis.client.set.mock.calls[0][3]).toBe(300);
  });

  it('fresh reads past a hit and rewrites the key', async () => {
    const redis = fakeRedis();
    redis.store.set('deal:report-window:v1:jobs:2026-09-01:2026-09-30', { value: gzipSync('[{"id":"old"}]'), ttl: 1 });
    const rows = await new ReportWindowCache(redis.service).read(
      { kind: 'jobs', from: '2026-09-01', to: '2026-09-30' },
      async () => [{ id: 'new' }],
      { now, fresh: true },
    );
    expect(rows).toEqual([{ id: 'new' }]);
    expect(JSON.parse(gunzipSync(redis.store.get('deal:report-window:v1:jobs:2026-09-01:2026-09-30')!.value).toString())).toEqual([
      { id: 'new' },
    ]);
  });

  it('never stores a value past the size cap — the read is still answered', async () => {
    const redis = fakeRedis();
    const cache = new ReportWindowCache(redis.service, { maxBytes: 64 });
    // Random strings do not compress: well past 64 bytes gzipped.
    const big = Array.from({ length: 50 }, (_, i) => ({ id: `${i}-${Math.random().toString(36)}` }));
    expect(await cache.read({ kind: 'jobs', from: '2026-01-01', to: '2026-06-30' }, async () => big, { now })).toEqual(big);
    expect(redis.client.set).not.toHaveBeenCalled();
    expect(REPORT_WINDOW_CACHE_MAX_BYTES).toBe(4 * 1024 * 1024);
  });

  it('a Redis that fails, or is not wired, costs the cache and never the report', async () => {
    const broken = {
      client: {
        getBuffer: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')),
        set: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')),
      },
    };
    const w = { kind: 'jobs', from: '2026-09-01', to: '2026-09-30' };
    expect(await new ReportWindowCache(broken as never).read(w, async () => [1], { now })).toEqual([1]);
    expect(await new ReportWindowCache().read(w, async () => [2], { now })).toEqual([2]);
  });

  it('a failed read is never stored, and the next ask reads again', async () => {
    const redis = fakeRedis();
    const cache = new ReportWindowCache(redis.service);
    const w = { kind: 'jobs', from: '2026-09-01', to: '2026-09-30' };
    await expect(cache.read(w, async () => Promise.reject(new Error('throttled')), { now })).rejects.toThrow('throttled');
    expect(redis.client.set).not.toHaveBeenCalled();
    expect(await cache.read(w, async () => ['ok'], { now })).toEqual(['ok']);
  });
});
