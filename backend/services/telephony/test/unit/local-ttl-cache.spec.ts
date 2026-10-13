import { LocalTtlCache } from '../../src/common/local-ttl-cache';

const flush = () => new Promise((r) => setImmediate(r));

function make(ttlMs = 30_000) {
  let now = 0;
  const cache = new LocalTtlCache<string[]>(ttlMs, () => now);
  return { cache, advance: (ms: number) => (now += ms) };
}

describe('LocalTtlCache', () => {
  it('serves the loaded value until the TTL passes', async () => {
    const { cache, advance } = make();
    const loader = jest.fn().mockResolvedValueOnce(['a']).mockResolvedValueOnce(['b']);

    expect(await cache.get(loader)).toEqual(['a']);
    advance(29_999);
    expect(await cache.get(loader)).toEqual(['a']);
    advance(2);
    expect(await cache.get(loader)).toEqual(['b']);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('single-flight: concurrent callers share one load', async () => {
    const { cache } = make();
    let resolve!: (v: string[]) => void;
    const loader = jest.fn(() => new Promise<string[]>((r) => (resolve = r)));
    const a = cache.get(loader);
    const b = cache.get(loader);
    resolve(['x']);
    expect(await a).toEqual(['x']);
    expect(await b).toEqual(['x']);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('never caches an error', async () => {
    const { cache } = make();
    await expect(cache.get(async () => Promise.reject(new Error('down')))).rejects.toThrow('down');
    expect(await cache.get(async () => ['ok'])).toEqual(['ok']);
  });

  it('invalidate drops the value, and a load in flight across it is not kept', async () => {
    const { cache } = make();
    let resolve!: (v: string[]) => void;
    const inflight = cache.get(() => new Promise<string[]>((r) => (resolve = r)));
    await flush();
    cache.invalidate();
    resolve(['before-write']);
    expect(await inflight).toEqual(['before-write']);

    const loader = jest.fn().mockResolvedValue(['after-write']);
    expect(await cache.get(loader)).toEqual(['after-write']);
    expect(loader).toHaveBeenCalledTimes(1);
  });
});
