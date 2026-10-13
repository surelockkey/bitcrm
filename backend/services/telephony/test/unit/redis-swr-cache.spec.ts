import { RedisSwrCache } from '../../src/common/redis-swr-cache';
import { FakeRedisKv } from './helpers/fake-redis-kv';

/**
 * The Twilio number list is shared across tasks through Redis: fresh for five
 * minutes, served stale (while one refresh runs) after that, never an error
 * cached, and the last good value served when Twilio itself is failing.
 */

const FRESH = 5 * 60_000;
const STALE = 60 * 60_000;

function make(opts: { redis?: FakeRedisKv | null } = {}) {
  const redis = opts.redis === undefined ? new FakeRedisKv() : opts.redis;
  let now = 1_000_000;
  const clock = { now: () => now, advance: (ms: number) => (now += ms) };
  const cache = new RedisSwrCache<string[]>(
    redis ? ({ client: redis } as never) : undefined,
    'telephony:test:list',
    { freshMs: FRESH, staleMs: STALE },
    clock.now,
  );
  return { cache, redis: redis!, clock };
}

/** Let background refreshes settle. */
const flush = () => new Promise((r) => setImmediate(r));

describe('RedisSwrCache', () => {
  it('loads once, then serves the cached value while fresh', async () => {
    const { cache, clock } = make();
    const loader = jest.fn().mockResolvedValue(['a']);

    expect(await cache.get(loader)).toEqual(['a']);
    clock.advance(FRESH - 1);
    expect(await cache.get(loader)).toEqual(['a']);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('shares the value across instances (tasks) through Redis', async () => {
    const { cache, redis, clock } = make();
    await cache.get(async () => ['a']);

    const other = new RedisSwrCache<string[]>(
      { client: redis } as never,
      'telephony:test:list',
      { freshMs: FRESH, staleMs: STALE },
      clock.now,
    );
    const loader = jest.fn().mockResolvedValue(['b']);
    expect(await other.get(loader)).toEqual(['a']);
    expect(loader).not.toHaveBeenCalled();
  });

  it('single-flight: concurrent misses share one load', async () => {
    const { cache } = make();
    let resolve!: (v: string[]) => void;
    const loader = jest.fn(() => new Promise<string[]>((r) => (resolve = r)));

    const a = cache.get(loader);
    const b = cache.get(loader);
    await flush();
    resolve(['a']);
    expect(await a).toEqual(['a']);
    expect(await b).toEqual(['a']);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('stale: answers with the old value at once and refreshes in the background', async () => {
    const { cache, clock } = make();
    await cache.get(async () => ['old']);
    clock.advance(FRESH + 1);

    const loader = jest.fn().mockResolvedValue(['new']);
    expect(await cache.get(loader)).toEqual(['old']);
    await flush();
    expect(loader).toHaveBeenCalledTimes(1);
    expect(await cache.get(loader)).toEqual(['new']);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('too old to serve stale: waits for the load', async () => {
    const { cache, clock } = make();
    await cache.get(async () => ['old']);
    clock.advance(STALE + 1);

    expect(await cache.get(async () => ['new'])).toEqual(['new']);
  });

  it('loader failure with a cached value present serves the cached value', async () => {
    const { cache, clock } = make();
    await cache.get(async () => ['good']);
    clock.advance(STALE + 1);

    const failing = jest.fn().mockRejectedValue(new Error('twilio 503'));
    expect(await cache.get(failing)).toEqual(['good']);
  });

  it('a failed stale refresh is not cached and is retried next time', async () => {
    const { cache, clock } = make();
    await cache.get(async () => ['good']);
    clock.advance(FRESH + 1);

    expect(await cache.get(async () => Promise.reject(new Error('boom')))).toEqual(['good']);
    await flush();
    const loader = jest.fn().mockResolvedValue(['fixed']);
    expect(await cache.get(loader)).toEqual(['good']); // still stale → served, refresh kicked
    await flush();
    expect(loader).toHaveBeenCalledTimes(1);
    expect(await cache.get(loader)).toEqual(['fixed']);
  });

  it('never caches an error: no value + loader failure rejects, and the next call retries', async () => {
    const { cache } = make();
    await expect(cache.get(async () => Promise.reject(new Error('down')))).rejects.toThrow('down');
    expect(await cache.get(async () => ['up'])).toEqual(['up']);
  });

  it('invalidate: the next read loads again, even on another instance', async () => {
    const { cache, redis } = make();
    await cache.get(async () => ['before']);
    await cache.invalidate();

    const other = new RedisSwrCache<string[]>(
      { client: redis } as never,
      'telephony:test:list',
      { freshMs: FRESH, staleMs: STALE },
    );
    expect(await other.get(async () => ['after'])).toEqual(['after']);
  });

  it('a load that started before an invalidation never becomes the cached value', async () => {
    const { cache } = make();
    let resolve!: (v: string[]) => void;
    const slow = cache.get(() => new Promise<string[]>((r) => (resolve = r)));
    await flush();

    await cache.invalidate(); // e.g. a number was bought meanwhile
    resolve(['pre-buy']);
    expect(await slow).toEqual(['pre-buy']); // its own caller still gets an answer

    const loader = jest.fn().mockResolvedValue(['post-buy']);
    expect(await cache.get(loader)).toEqual(['post-buy']);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('Redis down: every call goes to the loader, nothing throws', async () => {
    const { cache, redis } = make();
    redis.fail = true;
    const loader = jest.fn().mockResolvedValue(['live']);
    expect(await cache.get(loader)).toEqual(['live']);
    expect(await cache.get(loader)).toEqual(['live']);
    await expect(cache.invalidate()).resolves.toBeUndefined();
  });

  it('without Redis at all it is a pass-through', async () => {
    const { cache } = make({ redis: null });
    const loader = jest.fn().mockResolvedValue(['x']);
    await cache.get(loader);
    await cache.get(loader);
    expect(loader).toHaveBeenCalledTimes(2);
  });
});
