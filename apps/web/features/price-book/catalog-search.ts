"use client";

import { keepPreviousData, useQueries, useQuery } from "@tanstack/react-query";
import { InventoryStatus, type Product } from "@bitcrm/types";
import { queryKeys } from "@/lib/query-keys";
import { getProduct, listProducts } from "@/features/inventory/products/api";
import { useDebouncedValue } from "@/lib/use-debounced-value";

/**
 * The price book as the job and estimate item pickers read it.
 *
 * The pickers used to page the whole active catalog into the browser —
 * ~7 300 items on dev, 73 requests of 100 in a row, 18–28 s of "Loading
 * catalog…" on every page (QA 2026-10-14, web-flows 4.4 and 5.3). The server
 * searches the catalog itself (`GET /inventory/products?search=` matches the
 * name and the SKU, any case, off search-service's index when it is up), so
 * a picker asks for one page of what was typed and nothing more.
 */

/** Rows per answer: a screenful, well under the server's cap of 100. */
export const CATALOG_PAGE_SIZE = 50;

/**
 * Five minutes, not the app's thirty seconds: the catalog changes when the
 * office edits the price book, and those writes invalidate `products`
 * themselves (`useInvalidateProducts`, `useSaveItem`), so a page that opens
 * the picker again, or searches the same word again, reads nothing new.
 */
export const CATALOG_STALE_MS = 5 * 60_000;

/** How long typing rests before it is sent — one request per word, not per keystroke. */
const SEARCH_DEBOUNCE_MS = 300;

export interface CatalogSearch {
  /** The page for the settled text (the last page, while the next one is read). */
  products: Product[];
  /** The server has more than this page: say so, instead of reading it all. */
  hasMore: boolean;
  /** No page at all yet — the first open on this page. */
  isLoading: boolean;
  /** `products` is the previous text's page, kept while this text's is read. */
  isStale: boolean;
  isError: boolean;
  error: unknown;
}

/**
 * One page of the active catalog for `text`: the first page at once when the
 * box is empty, then what was typed once it has settled. Each page is kept
 * for {@link CATALOG_STALE_MS}, so the same open, or the same word, is free.
 * `enabled: false` while the search is not on screen (a line's own step).
 */
export function useCatalogSearch(text: string, enabled = true): CatalogSearch {
  const term = useDebouncedValue(text.trim(), SEARCH_DEBOUNCE_MS);
  const query = useQuery({
    queryKey: queryKeys.inventory.products.search(term),
    queryFn: () => listProducts({ status: InventoryStatus.ACTIVE, search: term }, undefined, CATALOG_PAGE_SIZE),
    enabled,
    staleTime: CATALOG_STALE_MS,
    placeholderData: keepPreviousData,
  });
  return {
    products: query.data?.data ?? [],
    hasMore: !!query.data?.pagination?.nextCursor,
    isLoading: query.isLoading && !query.data,
    isStale: query.isPlaceholderData,
    isError: query.isError,
    error: query.error,
  };
}

/**
 * One catalog item by id — the item behind a line being edited, for its
 * catalog price, type and costs. Nothing is read without an id.
 */
export function useCatalogProduct(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.inventory.products.detail(id ?? ""),
    queryFn: () => getProduct(id!),
    enabled: !!id,
    staleTime: CATALOG_STALE_MS,
  });
}

/**
 * Several catalog items by id, as a map — an item group's members, for the
 * SKU, type and costs an estimate line carries. `isPending` until every one
 * has answered; one that is gone from the catalog is simply not in the map.
 */
export function useCatalogProducts(ids: readonly string[]): { map: Map<string, Product>; isPending: boolean } {
  return useQueries({
    queries: ids.map((id) => ({
      queryKey: queryKeys.inventory.products.detail(id),
      queryFn: () => getProduct(id),
      staleTime: CATALOG_STALE_MS,
    })),
    combine: (results) => ({
      map: new Map(results.flatMap((r) => (r.data ? [[r.data.id, r.data] as const] : []))),
      isPending: results.some((r) => r.isPending),
    }),
  });
}
