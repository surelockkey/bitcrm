import { productSearchName, productSearchSku } from './products.constants';

/** The attributes of a stored row the search attributes are derived from. */
export interface ProductSearchRow {
  PK: string;
  SK: string;
  name?: string;
  sku?: string;
  searchName?: string;
  searchSku?: string;
}

export interface ProductSearchKeys {
  searchName: string;
  searchSku: string;
}

/**
 * The search attributes ProductsRepository would have written for this row,
 * or null when the row is not product metadata or already carries them.
 * Pure, so the backfill's decision can be tested without DynamoDB.
 */
export function productSearchKeysToWrite(row: ProductSearchRow): ProductSearchKeys | null {
  if (row.SK !== 'METADATA' || !row.PK.startsWith('PRODUCT#')) return null;

  const expected = {
    searchName: productSearchName(row.name ?? ''),
    searchSku: productSearchSku(row.sku ?? ''),
  };
  if (row.searchName === expected.searchName && row.searchSku === expected.searchSku) return null;
  return expected;
}
