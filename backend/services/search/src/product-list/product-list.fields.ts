/**
 * The `productList` object on a product document (index v4): what inventory's
 * Price Book list filters and sorts on, so a filtered `GET /products` or
 * `/products/count` is one OpenSearch query instead of a walk of the
 * ~16 MB `PRODUCTS#ALL` partition.
 *
 * Every field mirrors inventory's DynamoDB path exactly — the same rows must
 * match and in the same order, because a page cursor is good on either path
 * (inventory falls back to DynamoDB whenever search is not ready or fails):
 *   - `searchName` / `searchSku` = inventory's `productSearchName` /
 *     `productSearchSku` (trimmed, lowercased) — `contains` there, a
 *     `*term*` wildcard here;
 *   - `catalogSort` = the row's GSI4SK (`product-catalog-index.ts`): the
 *     lowercased name cut to 200 code points, `#`, the id;
 *   - `stockSort` = the row's GSI3SK (`product-stock-index.ts`): the whole
 *     lowercased name, `#`, the id — only on stock-managed products;
 *   - `stockManaged` = inventory's `manageStock=true` filter: a `product`
 *     whose flag is absent or true (a service never is);
 *   - `stockLevel` = Workiz's Stocked / Low against the re-order point,
 *     computed as inventory's FilterExpression decides it. `onHand` moves on
 *     every stock write; inventory publishes `product.updated` for it, so the
 *     document is rebuilt like any other product change.
 * Keyword fields sort by UTF-8 bytes, as DynamoDB sort keys do.
 */
export interface ProductListFields {
  productType?: string;
  status?: string;
  brandId?: string;
  /** Only when the row says it — `false` is what `manageStock=false` selects. */
  manageStock?: boolean;
  stockManaged: boolean;
  stockLevel: 'stocked' | 'low';
  searchName: string;
  searchSku?: string;
  catalogSort: string;
  stockSort?: string;
}

/** How much of the name orders a GSI4 row (inventory's `SORT_NAME_CHARS`). */
const CATALOG_SORT_NAME_CHARS = 200;

export interface ProductListSource {
  id: string;
  name?: string;
  sku?: string;
  type?: string;
  status?: string;
  brandId?: string;
  manageStock?: boolean;
  onHand?: number;
  reorderLevel?: number;
}

const lower = (s: string | undefined) => (typeof s === 'string' ? s.trim().toLowerCase() : '');

export function productListFields(p: ProductListSource): ProductListFields {
  const name = lower(p.name);
  const sku = lower(p.sku);
  const stockManaged = p.type === 'product' && p.manageStock !== false;
  const onHand = typeof p.onHand === 'number' ? p.onHand : undefined;
  const stocked =
    onHand !== undefined && onHand > 0 && (typeof p.reorderLevel !== 'number' || onHand > p.reorderLevel);
  return {
    ...(p.type && { productType: p.type }),
    ...(p.status && { status: p.status }),
    ...(p.brandId && { brandId: p.brandId }),
    ...(typeof p.manageStock === 'boolean' && { manageStock: p.manageStock }),
    stockManaged,
    stockLevel: stocked ? 'stocked' : 'low',
    searchName: name,
    ...(sku && { searchSku: sku }),
    catalogSort: `${[...name].slice(0, CATALOG_SORT_NAME_CHARS).join('')}#${p.id}`,
    ...(stockManaged && { stockSort: `${name}#${p.id}` }),
  };
}
