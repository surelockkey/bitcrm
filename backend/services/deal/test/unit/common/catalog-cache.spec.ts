import { CatalogCache, CATALOG_CACHE_TTL_MS } from 'src/common/cache/catalog-cache';

describe('CatalogCache', () => {
  let now: number;
  const clock = () => now;

  beforeEach(() => {
    now = 1_000_000;
  });

  it('keeps a catalog for sixty seconds by default', () => {
    expect(CATALOG_CACHE_TTL_MS).toBe(60_000);
  });

  it('reads once and serves the next calls from memory until the TTL runs out', async () => {
    const load = jest.fn().mockResolvedValue([{ id: 'a' }]);
    const cache = new CatalogCache(load, 60_000, clock);

    expect(await cache.get()).toEqual([{ id: 'a' }]);
    now += 59_999;
    expect(await cache.get()).toEqual([{ id: 'a' }]);
    expect(load).toHaveBeenCalledTimes(1);

    now += 1;
    await cache.get();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('concurrent misses share one read (single-flight)', async () => {
    let resolve!: (rows: { id: string }[]) => void;
    const load = jest.fn(() => new Promise<{ id: string }[]>((r) => (resolve = r)));
    const cache = new CatalogCache(load, 60_000, clock);

    const all = Promise.all([cache.get(), cache.get(), cache.get()]);
    resolve([{ id: 'a' }]);
    const answers = await all;

    expect(load).toHaveBeenCalledTimes(1);
    expect(answers).toEqual([[{ id: 'a' }], [{ id: 'a' }], [{ id: 'a' }]]);
  });

  it('hands every caller its own array, so sorting or filtering one never reorders the cache', async () => {
    const cache = new CatalogCache(async () => [{ id: 'b' }, { id: 'a' }], 60_000, clock);

    const first = await cache.get();
    first.reverse();
    first.push({ id: 'z' });

    expect(await cache.get()).toEqual([{ id: 'b' }, { id: 'a' }]);
  });

  it('invalidate() makes the next call read again', async () => {
    const load = jest.fn().mockResolvedValueOnce([{ id: 'a' }]).mockResolvedValueOnce([{ id: 'a' }, { id: 'b' }]);
    const cache = new CatalogCache(load, 60_000, clock);

    await cache.get();
    cache.invalidate();

    expect(await cache.get()).toEqual([{ id: 'a' }, { id: 'b' }]);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('a read that was in flight when the catalog changed is not kept', async () => {
    const resolvers: ((rows: { id: string }[]) => void)[] = [];
    const load = jest.fn(() => new Promise<{ id: string }[]>((r) => resolvers.push(r)));
    const cache = new CatalogCache(load, 60_000, clock);

    const stale = cache.get();
    cache.invalidate(); // a write landed while the read was out
    resolvers[0]([{ id: 'old' }]);
    await stale;

    const fresh = cache.get();
    expect(load).toHaveBeenCalledTimes(2);
    resolvers[1]([{ id: 'new' }]);
    expect(await fresh).toEqual([{ id: 'new' }]);
  });

  it('a failed read is not cached and the next call tries again', async () => {
    const load = jest.fn().mockRejectedValueOnce(new Error('dynamo down')).mockResolvedValueOnce([{ id: 'a' }]);
    const cache = new CatalogCache(load, 60_000, clock);

    await expect(cache.get()).rejects.toThrow('dynamo down');
    expect(await cache.get()).toEqual([{ id: 'a' }]);
    expect(load).toHaveBeenCalledTimes(2);
  });
});
