import { type Product, ProductType } from '@bitcrm/types';
import { productSearchName, productSearchSku } from './products.constants';
import type { ProductListPartition, SearchableProductFilters } from './product-list-search.client';

/**
 * The list filters as a predicate on a stored product — exactly what the
 * repository's FilterExpression (`filterParts`) selects. A page from search
 * names its rows by id; the rows are then loaded from here, fresh, and a row
 * that changed since search indexed it (an edit seconds ago) is checked again
 * so a stale match is never shown.
 */
export function matchesProductListFilters(
  product: Product & { onHand?: number; reorderLevel?: number; manageStock?: boolean; brandId?: string },
  filters: SearchableProductFilters,
  partition: ProductListPartition,
): boolean {
  const stockManaged = product.type === ProductType.PRODUCT && product.manageStock !== false;
  if (partition === 'stock' && !stockManaged) return false;
  if (filters.type && product.type !== filters.type) return false;
  if (filters.status && product.status !== filters.status) return false;
  const term = filters.search?.trim() ? productSearchName(filters.search) : '';
  if (term) {
    const inName = typeof product.name === 'string' && productSearchName(product.name).includes(term);
    const inSku = typeof product.sku === 'string' && productSearchSku(product.sku).includes(term);
    if (!inName && !inSku) return false;
  }
  if (filters.brandId && product.brandId !== filters.brandId) return false;
  if (filters.manageStock === true && !stockManaged) return false;
  if (filters.manageStock === false && product.manageStock !== false) return false;
  if (filters.stockLevel) {
    const onHand = typeof product.onHand === 'number' ? product.onHand : undefined;
    const stocked =
      onHand !== undefined &&
      onHand > 0 &&
      (typeof product.reorderLevel !== 'number' || onHand > product.reorderLevel);
    if ((filters.stockLevel === 'stocked') !== stocked) return false;
  }
  return true;
}
