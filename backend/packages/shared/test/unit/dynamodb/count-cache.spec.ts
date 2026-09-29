import {
  cachedCount,
  countCacheKey,
  type CountCacheClient,
} from '../../../src/dynamodb/count-cache';
import { type CountRowsResult } from '../../../src/dynamodb/count-rows';

/**
 * The count sits behind a short-lived cache because the list under it does
 * not: a dispatcher flipping between tabs and filters would otherwise re-walk
 * the index on every page load.
 *
 * It is also strictly a nice-to-have. The list renders without it, so a Redis
 * that is down or a value that will not parse must cost the panel its number,
 * never the page.
 */
describe('cachedCount', () => {
  const result = (total: number, atLeast = false): CountRowsResult => ({ total, atLeast });

  function fakeRedis(seed: Record<string, string> = {}) {
    const store = new Map(Object.entries(seed));
    const client: CountCacheClient = {
      get: jest.fn(async (key: string) => store.get(key) ?? null),
      set: jest.fn(async (key: string, value: string) => {
        store.set(key, value);
        return 'OK';
      }),
    };
    return { client, store };
  }

  it('counts on a miss and stores what it found', async () => {
    const { client, store } = fakeRedis();
    const count = jest.fn(async () => result(277));

    expect(await cachedCount(client, 'k', 30, count)).toEqual(result(277));
    expect(count).toHaveBeenCalledTimes(1);
    expect(JSON.parse(store.get('k')!)).toEqual(result(277));
  });

  it('answers a hit without counting again', async () => {
    const { client } = fakeRedis({ k: JSON.stringify(result(277)) });
    const count = jest.fn(async () => result(999));

    expect(await cachedCount(client, 'k', 30, count)).toEqual(result(277));
    expect(count).not.toHaveBeenCalled();
  });

  it('keeps the floor flag across the cache', async () => {
    const { client } = fakeRedis({ k: JSON.stringify(result(10_000, true)) });

    expect(await cachedCount(client, 'k', 30, jest.fn())).toEqual(result(10_000, true));
  });

  it('stores under the caller’s ttl', async () => {
    const { client } = fakeRedis();
    await cachedCount(client, 'k', 45, async () => result(1));

    expect(client.set).toHaveBeenCalledWith('k', JSON.stringify(result(1)), 'EX', 45);
  });

  // Redis down, or a value written by an older shape of this code: count.
  it('counts when the cached value will not parse', async () => {
    const { client } = fakeRedis({ k: 'not json' });
    const count = jest.fn(async () => result(5));

    expect(await cachedCount(client, 'k', 30, count)).toEqual(result(5));
    expect(count).toHaveBeenCalledTimes(1);
  });

  it('counts when the read throws', async () => {
    const client: CountCacheClient = {
      get: jest.fn(async () => {
        throw new Error('ECONNREFUSED');
      }),
      set: jest.fn(async () => 'OK'),
    };

    expect(await cachedCount(client, 'k', 30, async () => result(5))).toEqual(result(5));
  });

  it('still answers when the write throws', async () => {
    const client: CountCacheClient = {
      get: jest.fn(async () => null),
      set: jest.fn(async () => {
        throw new Error('READONLY');
      }),
    };

    expect(await cachedCount(client, 'k', 30, async () => result(5))).toEqual(result(5));
  });
});

/**
 * One list, one key. The filters are part of it: "how many products" and "how
 * many products in this category" are different questions with different
 * answers, and a shared key would hand one the other's number.
 */
describe('countCacheKey', () => {
  it('is stable for the same filters', () => {
    expect(countCacheKey('products', { status: 'active' })).toBe(
      countCacheKey('products', { status: 'active' }),
    );
  });

  it('ignores the order the filters were written in', () => {
    expect(countCacheKey('products', { a: 1, b: 2 })).toBe(countCacheKey('products', { b: 2, a: 1 }));
  });

  it('separates different filters', () => {
    expect(countCacheKey('products', { status: 'active' })).not.toBe(
      countCacheKey('products', { status: 'archived' }),
    );
  });

  it('separates different lists carrying the same filters', () => {
    expect(countCacheKey('products', { q: 1 })).not.toBe(countCacheKey('transfers', { q: 1 }));
  });

  it('names the list in the key, so the cache can be read by a human', () => {
    expect(countCacheKey('products', {})).toMatch(/^list-count:products:/);
  });

  it('treats an absent filter and an undefined one as the same question', () => {
    expect(countCacheKey('products', { status: undefined })).toBe(countCacheKey('products', {}));
  });
});
