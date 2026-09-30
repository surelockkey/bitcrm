"use client";

import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import { queryKeys } from "@/lib/query-keys";
import { getApiErrorMessage } from "@/lib/api/errors";
import { countProducts, listProducts } from "@/features/inventory/products/api";
import type { ProductFilter } from "@/features/inventory/products/lib";
import * as api from "./api";
import type { CatalogCreateBody, CatalogUpdateBody } from "./api";

/**
 * One server page of the whole catalog under the toolbar's filters.
 *
 * Filed under the same key Inventory's list uses, so a save in the item popup
 * (which invalidates `products`) refreshes this list too. The previous rows
 * stay on screen while a new filter loads, instead of a skeleton flashing on
 * every keystroke.
 */
export function usePriceBookItems(filter: ProductFilter, limit: number) {
  return useInfiniteQuery({
    queryKey: queryKeys.inventory.products.list({ ...filter, limit }),
    queryFn: ({ pageParam }) => listProducts(filter, pageParam, limit),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.pagination.nextCursor,
    placeholderData: keepPreviousData,
  });
}

/** How many items the same filters hold — "Page 2 of 7". The server keeps it 30s. */
export function usePriceBookCount(filter: ProductFilter) {
  return useQuery({
    queryKey: queryKeys.inventory.products.count(filter),
    queryFn: () => countProducts(filter),
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
}

/* ------------------------------------------------------------------ *
 * The two small catalogs: item categories and brands
 * ------------------------------------------------------------------ */

export type CatalogKind = "categories" | "brands";

const CATALOG = {
  categories: {
    noun: "Category",
    create: api.createItemCategory,
    update: api.updateItemCategory,
    all: queryKeys.inventory.categories.all,
  },
  brands: {
    noun: "Brand",
    create: api.createBrand,
    update: api.updateBrand,
    all: queryKeys.inventory.brands.all,
  },
} as const;

export function useCreateCatalogEntry(kind: CatalogKind) {
  const qc = useQueryClient();
  const c = CATALOG[kind];
  return useMutation({
    mutationFn: (body: CatalogCreateBody) => c.create(body),
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: c.all() });
      toast.success(`${c.noun} “${row.name}” created`);
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

/** Save, archive (`active: false`) and restore (`active: true`) are all this one PUT. */
export function useUpdateCatalogEntry(kind: CatalogKind) {
  const qc = useQueryClient();
  const c = CATALOG[kind];
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: CatalogUpdateBody }) => c.update(id, body),
    onSuccess: (_row, { body }) => {
      qc.invalidateQueries({ queryKey: c.all() });
      const onlyActive = body.name === undefined && body.active !== undefined;
      toast.success(
        onlyActive ? `${c.noun} ${body.active ? "restored" : "archived"}` : `${c.noun} saved`,
      );
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}
