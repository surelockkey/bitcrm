"use client";

import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { InventoryStatus } from "@bitcrm/types";
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

/**
 * Workiz's "No. of active items" beside each category: the active items filed
 * under each name, one count per category (the server keeps each 30s), under
 * the key the Items tab's own count uses. `isLoading` holds until every one
 * has answered, so the column fills in with the rows, not after them.
 */
export function useCategoryItemCounts(names: readonly string[], enabled: boolean) {
  return useQueries({
    queries: names.map((category) => {
      const filter = { category, status: InventoryStatus.ACTIVE };
      return {
        queryKey: queryKeys.inventory.products.count(filter),
        queryFn: () => countProducts(filter),
        staleTime: 30_000,
        enabled,
      };
    }),
    combine: (results) => ({
      counts: new Map(
        names.flatMap((name, i) => {
          const total = results[i]?.data?.total;
          return typeof total === "number" ? [[name, total] as const] : [];
        }),
      ),
      isLoading: enabled && results.some((r) => r.isPending && r.fetchStatus !== "idle"),
    }),
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: c.all() });
      // Workiz's words ("Category successfully created").
      toast.success(`${c.noun} successfully created`);
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

/**
 * Save, disable (`active: false`) and enable (`active: true`) are all this
 * one PUT. A category's new name moves its items on the server, so their
 * lists and counts are asked for again too.
 */
export function useUpdateCatalogEntry(kind: CatalogKind) {
  const qc = useQueryClient();
  const c = CATALOG[kind];
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: CatalogUpdateBody }) => c.update(id, body),
    onSuccess: (_row, { body }) => {
      qc.invalidateQueries({ queryKey: c.all() });
      if (kind === "categories" && body.name !== undefined) {
        qc.invalidateQueries({ queryKey: queryKeys.inventory.products.all() });
      }
      const onlyActive = body.name === undefined && body.description === undefined && body.active !== undefined;
      toast.success(
        onlyActive ? `${c.noun} ${body.active ? "enabled" : "disabled"}` : `${c.noun} successfully updated`,
      );
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}
