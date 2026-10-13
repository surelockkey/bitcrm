import { BadRequestException } from '@nestjs/common';

/**
 * Which inventory partition the list stands for: `catalog` is the Price Book
 * (`PRODUCTS#ALL`, GSI4 order), `stock` the stock-managed products
 * (`PRODUCTS#STOCK`, GSI3 order) that inventory reads for `manageStock=true`.
 */
export type ProductListPartition = 'catalog' | 'stock';

/** Inventory's `ProductListFilters`, same names and meanings. */
export interface ProductListFilters {
  type?: string;
  status?: string;
  search?: string;
  brandId?: string;
  manageStock?: boolean;
  stockLevel?: 'stocked' | 'low';
}

export interface ProductListQuery {
  partition: ProductListPartition;
  filters: ProductListFilters;
  /** Rows on the page, 1..100. */
  limit: number;
  /** The sort key of the last row of the previous page (the cursor's GSI4SK / GSI3SK). */
  after?: string;
}

export type ProductListMode = 'page' | 'count';

const SORT_FIELD: Record<ProductListPartition, string> = {
  catalog: 'productList.catalogSort',
  stock: 'productList.stockSort',
};

const STOCK_LEVELS = new Set(['stocked', 'low']);

/** `*` and `?` are wildcard operators and `\` their escape; anything else is literal. */
function escapeWildcard(term: string): string {
  return term.replace(/[\\*?]/g, (c) => `\\${c}`);
}

/**
 * The OpenSearch body for a page (ids in partition order, one row more than
 * asked so the caller knows whether another page follows) or a count (the
 * exact total). Each filter is the term that selects the rows inventory's
 * FilterExpression selects (`products.repository.ts` `filterParts`).
 */
export function buildProductListBody(q: ProductListQuery, mode: ProductListMode): Record<string, any> {
  const filter: Record<string, any>[] = [{ term: { type: 'product' } }];
  const f = q.filters;
  if (q.partition === 'stock') filter.push({ term: { 'productList.stockManaged': true } });
  if (f.type) filter.push({ term: { 'productList.productType': f.type } });
  if (f.status) filter.push({ term: { 'productList.status': f.status } });
  const term = f.search?.trim().toLowerCase();
  if (term) {
    const value = `*${escapeWildcard(term)}*`;
    filter.push({
      bool: {
        should: [
          { wildcard: { 'productList.searchName': { value } } },
          { wildcard: { 'productList.searchSku': { value } } },
        ],
        minimum_should_match: 1,
      },
    });
  }
  if (f.brandId) filter.push({ term: { 'productList.brandId': f.brandId } });
  if (f.manageStock === true) filter.push({ term: { 'productList.stockManaged': true } });
  else if (f.manageStock === false) filter.push({ term: { 'productList.manageStock': false } });
  if (f.stockLevel) filter.push({ term: { 'productList.stockLevel': f.stockLevel } });

  const query = { bool: { filter } };
  if (mode === 'count') return { size: 0, track_total_hits: true, query };
  return {
    size: q.limit + 1,
    track_total_hits: false,
    _source: ['entityId'],
    sort: [{ [SORT_FIELD[q.partition]]: 'asc' }],
    ...(q.after && { search_after: [q.after] }),
    query,
  };
}

function optionalString(value: unknown, name: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw new BadRequestException(`${name} must be a string`);
  return value;
}

/**
 * The internal route's body, checked by hand — search runs no ValidationPipe.
 * Anything it could not answer exactly as inventory's DynamoDB path would is
 * a 400 (inventory then reads DynamoDB), never a guess.
 */
export function parseProductListInput(body: any): { mode: ProductListMode; query: ProductListQuery } {
  const b = body && typeof body === 'object' ? body : {};
  const mode = b.mode ?? 'page';
  if (mode !== 'page' && mode !== 'count') throw new BadRequestException('mode must be page or count');
  const partition = b.partition ?? 'catalog';
  if (partition !== 'catalog' && partition !== 'stock') throw new BadRequestException('partition must be catalog or stock');
  const limit = Math.min(Math.max(Math.trunc(Number(b.limit)) || 20, 1), 100);
  const after = optionalString(b.after, 'after');

  const raw = b.filters && typeof b.filters === 'object' ? b.filters : {};
  const filters: ProductListFilters = {};
  for (const key of ['type', 'status', 'search', 'brandId'] as const) {
    const v = optionalString(raw[key], key);
    if (v !== undefined) filters[key] = v;
  }
  if (raw.manageStock === true || raw.manageStock === 'true') filters.manageStock = true;
  else if (raw.manageStock === false || raw.manageStock === 'false') filters.manageStock = false;
  else if (raw.manageStock !== undefined && raw.manageStock !== null) {
    throw new BadRequestException('manageStock must be a boolean');
  }
  const level = optionalString(raw.stockLevel, 'stockLevel');
  if (level !== undefined) {
    if (!STOCK_LEVELS.has(level)) throw new BadRequestException('stockLevel must be stocked or low');
    filters.stockLevel = level as 'stocked' | 'low';
  }

  return { mode, query: { partition, limit, ...(after && { after }), filters } };
}
