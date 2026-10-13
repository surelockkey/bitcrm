/**
 * The client of search-service's `POST /internal/products/query`. Every
 * answer that is not a usable one — no SEARCH_SERVICE_URL, `ready: false`,
 * an HTTP error, a timeout — is `null`, and the caller reads DynamoDB as it
 * always did. "Not ready" is remembered for a minute and a failure for half
 * a minute, so a missing or broken search never costs every request a call.
 */
import { ProductListSearchClient } from 'src/products/product-list-search.client';

const ok = (data: unknown) => ({ ok: true, status: 200, json: async () => ({ success: true, data }) });

describe('ProductListSearchClient', () => {
  let fetchMock: jest.Mock;
  let now: number;
  const make = (base: string | undefined = 'http://search:4005') =>
    new ProductListSearchClient({ baseUrl: base, secret: 's3cret', timeoutMs: 1000, fetch: fetchMock as any, now: () => now });

  beforeEach(() => {
    fetchMock = jest.fn();
    now = 1_000_000;
  });

  it('is off without a search URL — asks nothing', async () => {
    const c = make('');
    expect(await c.page('catalog', { status: 'active' }, 20)).toBeNull();
    expect(await c.count('catalog', { status: 'active' })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts the filters with the internal secret and a timeout, and answers ids + next', async () => {
    fetchMock.mockResolvedValue(ok({ ready: true, ids: ['a', 'b'], next: 'b#b' }));
    const out = await make().page('stock', { status: 'active', stockLevel: 'low' }, 2, 'a#0');

    expect(out).toEqual({ ids: ['a', 'b'], next: 'b#b' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://search:4005/api/search/internal/products/query');
    expect(init.method).toBe('POST');
    expect(init.headers['x-internal-secret']).toBe('s3cret');
    expect(init.headers['content-type']).toBe('application/json');
    expect(init.signal).toBeDefined();
    expect(JSON.parse(init.body)).toEqual({
      mode: 'page',
      partition: 'stock',
      limit: 2,
      after: 'a#0',
      filters: { status: 'active', stockLevel: 'low' },
    });
  });

  it('a count is the total', async () => {
    fetchMock.mockResolvedValue(ok({ ready: true, total: 42 }));
    expect(await make().count('catalog', { type: 'service' })).toBe(42);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ mode: 'count', partition: 'catalog' });
  });

  it('not ready → null, and search is not asked again for a minute', async () => {
    fetchMock.mockResolvedValue(ok({ ready: false }));
    const c = make();
    expect(await c.page('catalog', { status: 'active' }, 20)).toBeNull();
    now += 30_000;
    expect(await c.count('catalog', { status: 'active' })).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    now += 31_000;
    fetchMock.mockResolvedValue(ok({ ready: true, total: 1 }));
    expect(await c.count('catalog', { status: 'active' })).toBe(1);
  });

  it('an error, a non-2xx or a timeout → null, and search rests for 30 seconds', async () => {
    const c = make();
    fetchMock.mockRejectedValueOnce(Object.assign(new Error('aborted'), { name: 'TimeoutError' }));
    expect(await c.page('catalog', { status: 'active' }, 20)).toBeNull();
    expect(await c.page('catalog', { status: 'active' }, 20)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    now += 31_000;
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) });
    expect(await c.count('catalog', { status: 'active' })).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('an answer of the wrong shape is not trusted', async () => {
    fetchMock.mockResolvedValue(ok({ ready: true, ids: 'nope' }));
    expect(await make().page('catalog', { status: 'active' }, 20)).toBeNull();
    fetchMock.mockResolvedValue(ok({ ready: true, total: 'x' }));
    now += 31_000;
    expect(await make().count('catalog', { status: 'active' })).toBeNull();
  });
});
