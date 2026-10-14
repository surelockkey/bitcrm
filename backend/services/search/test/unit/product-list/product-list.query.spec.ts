/**
 * The Price Book list on the read model (`POST /internal/products/query`):
 * inventory's filtered `GET /products` and `/products/count` ask here instead
 * of walking the ~16 MB `PRODUCTS#ALL` partition. Each filter must select
 * exactly the rows inventory's DynamoDB FilterExpression selects, in the same
 * order, so a cursor works on either path.
 */
import { buildProductListBody, parseProductListInput } from 'src/product-list/product-list.query';

const filters = (body: any) => body.query.bool.filter as any[];

describe('buildProductListBody', () => {
  it('pages the catalog by the GSI4 sort key, one more than asked (to know if more follow), ids only', () => {
    const body = buildProductListBody({ partition: 'catalog', filters: { status: 'active' }, limit: 20 }, 'page');
    expect(body.size).toBe(21);
    expect(body.sort).toEqual([{ 'productList.catalogSort': 'asc' }]);
    expect(body._source).toEqual(['entityId']);
    expect(body.track_total_hits).toBe(false);
    expect(body.search_after).toBeUndefined();
    expect(filters(body)).toEqual([
      { term: { type: 'product' } },
      { term: { 'productList.status': 'active' } },
    ]);
  });

  it('resumes after the sort key the cursor carries', () => {
    const body = buildProductListBody(
      { partition: 'catalog', filters: { type: 'service' }, limit: 10, after: 'kwikset#p1' },
      'page',
    );
    expect(body.search_after).toEqual(['kwikset#p1']);
  });

  it('the stock partition is the stock-managed products, by the GSI3 sort key', () => {
    const body = buildProductListBody({ partition: 'stock', filters: { brandId: 'b1' }, limit: 10 }, 'page');
    expect(body.sort).toEqual([{ 'productList.stockSort': 'asc' }]);
    expect(filters(body)).toEqual(
      expect.arrayContaining([
        { term: { 'productList.stockManaged': true } },
        { term: { 'productList.brandId': 'b1' } },
      ]),
    );
  });

  it('manageStock=true is the stock-managed rows; manageStock=false only the rows that say so', () => {
    expect(filters(buildProductListBody({ partition: 'catalog', filters: { manageStock: true }, limit: 5 }, 'page'))).toContainEqual({
      term: { 'productList.stockManaged': true },
    });
    expect(filters(buildProductListBody({ partition: 'catalog', filters: { manageStock: false }, limit: 5 }, 'page'))).toContainEqual({
      term: { 'productList.manageStock': false },
    });
  });

  it('matches the search term anywhere in the lowercased name or SKU (DynamoDB contains), wildcards escaped', () => {
    const body = buildProductListBody({ partition: 'catalog', filters: { search: '  Dead*Bolt? ' }, limit: 5 }, 'page');
    expect(filters(body)).toContainEqual({
      bool: {
        should: [
          { wildcard: { 'productList.searchName': { value: '*dead\\*bolt\\?*' } } },
          { wildcard: { 'productList.searchSku': { value: '*dead\\*bolt\\?*' } } },
        ],
        minimum_should_match: 1,
      },
    });
  });

  it('stock level is the precomputed keyword', () => {
    expect(filters(buildProductListBody({ partition: 'catalog', filters: { stockLevel: 'low' }, limit: 5 }, 'page'))).toContainEqual({
      term: { 'productList.stockLevel': 'low' },
    });
  });

  it('a count asks for the exact total and no hits', () => {
    const body = buildProductListBody({ partition: 'catalog', filters: { type: 'product' }, limit: 20 }, 'count');
    expect(body.size).toBe(0);
    expect(body.track_total_hits).toBe(true);
    expect(body.sort).toBeUndefined();
  });
});

describe('parseProductListInput (search runs no ValidationPipe)', () => {
  it('coerces and keeps only the known filters', () => {
    expect(
      parseProductListInput({
        partition: 'stock',
        mode: 'count',
        limit: '25',
        after: 'x#1',
        filters: { type: 'product', status: 'active', search: 'abc', brandId: 'b', manageStock: 'false', stockLevel: 'stocked', evil: 1 },
      }),
    ).toEqual({
      mode: 'count',
      query: {
        partition: 'stock',
        limit: 25,
        after: 'x#1',
        filters: { type: 'product', status: 'active', search: 'abc', brandId: 'b', manageStock: false, stockLevel: 'stocked' },
      },
    });
  });

  it('defaults to a catalog page of 20 and clamps the limit to 1..100', () => {
    expect(parseProductListInput({})).toEqual({ mode: 'page', query: { partition: 'catalog', limit: 20, filters: {} } });
    expect(parseProductListInput({ limit: 1000 }).query.limit).toBe(100);
    expect(parseProductListInput({ limit: -3 }).query.limit).toBe(1);
  });

  it('refuses what it cannot answer faithfully', () => {
    expect(() => parseProductListInput({ partition: 'other' })).toThrow();
    expect(() => parseProductListInput({ filters: { stockLevel: 'empty' } })).toThrow();
    expect(() => parseProductListInput({ filters: { type: 7 } })).toThrow();
    expect(() => parseProductListInput({ mode: 'all' })).toThrow();
  });
});
