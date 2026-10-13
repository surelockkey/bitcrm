/**
 * The read side of the Price Book list and its readiness flag. Inventory must
 * never read a product list off an index that is not fully populated with
 * the `productList` fields, so every answer starts with "is it ready?" — the
 * meta document the product backfill stamps into the index the alias points
 * at (a new index version starts without it).
 */
import { ProductListReadiness, PRODUCT_LIST_META_ID, PRODUCT_LIST_SCHEMA } from 'src/product-list/product-list.readiness';
import { ProductListService } from 'src/product-list/product-list.service';
import { ProductListController } from 'src/product-list/product-list.controller';
import { SEARCH_INDEX_ALIAS } from 'src/common/constants/opensearch.constants';

function osWith(handlers: { get?: jest.Mock; search?: jest.Mock; index?: jest.Mock }) {
  return {
    client: {
      get: handlers.get ?? jest.fn().mockRejectedValue(Object.assign(new Error('not found'), { meta: { statusCode: 404 } })),
      search: handlers.search ?? jest.fn(),
      index: handlers.index ?? jest.fn().mockResolvedValue({}),
    },
  };
}

const readyDoc = { body: { found: true, _source: { schema: PRODUCT_LIST_SCHEMA, productListReadyAt: '2026-10-13T00:00:00Z' } } };

describe('ProductListReadiness', () => {
  it('is not ready while the meta document is missing (a fresh index version)', async () => {
    const r = new ProductListReadiness(osWith({}) as any);
    expect(await r.isReady()).toBe(false);
  });

  it('is ready once the backfill stamped the meta document of this schema', async () => {
    const get = jest.fn().mockResolvedValue(readyDoc);
    const r = new ProductListReadiness(osWith({ get }) as any);
    expect(await r.isReady()).toBe(true);
    expect(get).toHaveBeenCalledWith({ index: SEARCH_INDEX_ALIAS, id: PRODUCT_LIST_META_ID });
  });

  it('a meta document of another schema is not ready', async () => {
    const get = jest.fn().mockResolvedValue({ body: { found: true, _source: { schema: PRODUCT_LIST_SCHEMA - 1, productListReadyAt: 'x' } } });
    expect(await new ProductListReadiness(osWith({ get }) as any).isReady()).toBe(false);
  });

  it('remembers its answer for a minute either way — an alias swap is noticed within one', async () => {
    const get = jest.fn().mockResolvedValue(readyDoc);
    const r = new ProductListReadiness(osWith({ get }) as any);
    await r.isReady(1_000);
    await r.isReady(50_000);
    expect(get).toHaveBeenCalledTimes(1);
    await r.isReady(61_001);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('stamps the meta document (no text, archived, its own type — never a global-search hit)', async () => {
    const index = jest.fn().mockResolvedValue({});
    const r = new ProductListReadiness(osWith({ index }) as any);
    await r.stamp(16_234);
    const arg = index.mock.calls[0][0];
    expect(arg).toMatchObject({ index: SEARCH_INDEX_ALIAS, id: PRODUCT_LIST_META_ID });
    expect(arg.body).toMatchObject({ type: 'meta', status: 'archived', schema: PRODUCT_LIST_SCHEMA, count: 16_234 });
    expect(arg.body.title).toBeUndefined();
    expect(arg.body.keywords).toBeUndefined();
    // The next question is answered from the stamp, not the cache of "not ready".
    expect(await r.isReady()).toBe(true);
  });
});

describe('ProductListService', () => {
  const ready = { isReady: jest.fn().mockResolvedValue(true) };

  it('answers not ready without asking OpenSearch', async () => {
    const os = osWith({});
    const svc = new ProductListService(os as any, { isReady: jest.fn().mockResolvedValue(false) } as any);
    expect(await svc.page({ partition: 'catalog', filters: { status: 'active' }, limit: 20 })).toEqual({ ready: false });
    expect(os.client.search).not.toHaveBeenCalled();
  });

  it('a page: ids in order, and the sort key to resume after when more follow', async () => {
    const search = jest.fn().mockResolvedValue({
      body: {
        hits: {
          hits: [
            { _source: { entityId: 'a' }, sort: ['a#a'] },
            { _source: { entityId: 'b' }, sort: ['b#b'] },
            { _source: { entityId: 'c' }, sort: ['c#c'] },
          ],
        },
      },
    });
    const svc = new ProductListService(osWith({ search }) as any, ready as any);
    const out = await svc.page({ partition: 'catalog', filters: { status: 'active' }, limit: 2 });
    expect(out).toEqual({ ready: true, ids: ['a', 'b'], next: 'b#b' });
    expect(search.mock.calls[0][0].index).toBe(SEARCH_INDEX_ALIAS);
  });

  it('the last page has no next', async () => {
    const search = jest.fn().mockResolvedValue({ body: { hits: { hits: [{ _source: { entityId: 'a' }, sort: ['a#a'] }] } } });
    const svc = new ProductListService(osWith({ search }) as any, ready as any);
    expect(await svc.page({ partition: 'catalog', filters: { type: 'product' }, limit: 2 })).toEqual({ ready: true, ids: ['a'] });
  });

  it('a count is the exact total', async () => {
    const search = jest.fn().mockResolvedValue({ body: { hits: { total: { value: 1234, relation: 'eq' }, hits: [] } } });
    const svc = new ProductListService(osWith({ search }) as any, ready as any);
    expect(await svc.count({ partition: 'stock', filters: { stockLevel: 'low' }, limit: 20 })).toEqual({ ready: true, total: 1234 });
  });
});

describe('ProductListController', () => {
  it('routes a page or a count off the coerced body', async () => {
    const svc = { page: jest.fn().mockResolvedValue({ ready: true, ids: [] }), count: jest.fn().mockResolvedValue({ ready: true, total: 3 }) };
    const c = new ProductListController(svc as any);
    expect(await c.query({ mode: 'count', filters: { status: 'active' } })).toEqual({ success: true, data: { ready: true, total: 3 } });
    expect(svc.count).toHaveBeenCalledWith({ partition: 'catalog', limit: 20, filters: { status: 'active' } });
    await c.query({ limit: '5' });
    expect(svc.page).toHaveBeenCalledWith({ partition: 'catalog', limit: 5, filters: {} });
  });

  it('a body it cannot answer faithfully is a 400', async () => {
    const c = new ProductListController({} as any);
    await expect(c.query({ partition: 'nope' })).rejects.toMatchObject({ status: 400 });
  });
});
