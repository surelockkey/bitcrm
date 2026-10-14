import { RedisCachedValue } from '../../../src/common/redis-cached-value';
import { FakeRedis, fakeRedisService } from '../fake-redis';

/**
 * One list cached in Redis for every task of the service: read through,
 * single-flight, invalidated by a generation bump, a TTL as the safety net,
 * and no Redis means no cache — never an error.
 */
const deferred = <T>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe('RedisCachedValue', () => {
  it('loads once, then serves Redis until the TTL runs out', async () => {
    const redis = new FakeRedis();
    const cache = new RedisCachedValue<string[]>(fakeRedisService(redis), 'test:list', 300);
    const loader = jest.fn(async () => ['a', 'b']);

    expect(await cache.get(loader)).toEqual(['a', 'b']);
    expect(await cache.get(loader)).toEqual(['a', 'b']);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(redis.ttl('test:list')).toBe(300);

    redis.now += 300_001;
    expect(await cache.get(loader)).toEqual(['a', 'b']);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('is shared: a second instance (another task) reads what the first one wrote', async () => {
    const redis = new FakeRedis();
    const a = new RedisCachedValue<number>(fakeRedisService(redis), 'test:n', 300);
    const b = new RedisCachedValue<number>(fakeRedisService(redis), 'test:n', 300);
    await a.get(async () => 1);
    const loader = jest.fn(async () => 2);
    expect(await b.get(loader)).toBe(1);
    expect(loader).not.toHaveBeenCalled();
  });

  it('single-flights concurrent misses into one load', async () => {
    const redis = new FakeRedis();
    const cache = new RedisCachedValue<string>(fakeRedisService(redis), 'test:sf', 300);
    const gate = deferred<string>();
    const loader = jest.fn(() => gate.promise);

    const all = Promise.all([cache.get(loader), cache.get(loader), cache.get(loader)]);
    await new Promise((r) => setImmediate(r));
    gate.resolve('x');
    expect(await all).toEqual(['x', 'x', 'x']);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('invalidate() drops the value for every task', async () => {
    const redis = new FakeRedis();
    const a = new RedisCachedValue<number>(fakeRedisService(redis), 'test:inv', 300);
    const b = new RedisCachedValue<number>(fakeRedisService(redis), 'test:inv', 300);
    await a.get(async () => 1);
    await b.invalidate();
    expect(await a.get(async () => 2)).toBe(2);
  });

  it('a load that started before an invalidation never puts its pre-write answer back', async () => {
    const redis = new FakeRedis();
    const cache = new RedisCachedValue<string>(fakeRedisService(redis), 'test:race', 300);
    const other = new RedisCachedValue<string>(fakeRedisService(redis), 'test:race', 300);
    const gate = deferred<string>();

    const slow = cache.get(() => gate.promise); // started before the write
    await new Promise((r) => setImmediate(r));
    await other.invalidate(); // the write lands on another task
    gate.resolve('before');
    expect(await slow).toBe('before'); // the caller that asked still gets its answer

    const loader = jest.fn(async () => 'after');
    expect(await cache.get(loader)).toBe('after');
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('a get() after a local invalidate() does not join the load already in flight', async () => {
    const redis = new FakeRedis();
    const cache = new RedisCachedValue<string>(fakeRedisService(redis), 'test:join', 300);
    const gate = deferred<string>();
    const first = cache.get(() => gate.promise);
    await new Promise((r) => setImmediate(r));
    await cache.invalidate();
    const second = cache.get(async () => 'fresh');
    gate.resolve('stale');
    expect(await first).toBe('stale');
    expect(await second).toBe('fresh');
    expect(await cache.get(async () => 'never')).toBe('fresh');
  });

  it('never caches a failed load', async () => {
    const redis = new FakeRedis();
    const cache = new RedisCachedValue<string>(fakeRedisService(redis), 'test:fail', 300);
    await expect(cache.get(async () => Promise.reject(new Error('dynamo down')))).rejects.toThrow('dynamo down');
    expect(redis.peek('test:fail')).toBeNull();
    expect(await cache.get(async () => 'ok')).toBe('ok');
  });

  it('degrades to the loader when Redis is down, and without Redis at all', async () => {
    const redis = new FakeRedis();
    redis.down();
    const cache = new RedisCachedValue<string>(fakeRedisService(redis), 'test:down', 300);
    expect(await cache.get(async () => 'v')).toBe('v');
    await expect(cache.invalidate()).resolves.toBeUndefined();

    const none = new RedisCachedValue<string>(undefined, 'test:none', 300);
    const loader = jest.fn(async () => 'w');
    expect(await none.get(loader)).toBe('w');
    expect(await none.get(loader)).toBe('w');
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('treats an unparseable value as a miss', async () => {
    const redis = new FakeRedis();
    redis.write('test:junk', '{not json');
    const cache = new RedisCachedValue<string>(fakeRedisService(redis), 'test:junk', 300);
    expect(await cache.get(async () => 'v')).toBe('v');
  });
});
