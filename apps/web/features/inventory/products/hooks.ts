"use client";

import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import type { Product } from "@bitcrm/types";
import { queryKeys } from "@/lib/query-keys";
import { getApiErrorMessage } from "@/lib/api/errors";
import { rowFromLists } from "@/features/inventory/seed-from-lists";
import * as api from "./api";
import type { CreateProductValues, PatchProductValues } from "./schemas";
import type { ProductFilter } from "./lib";

export function useProducts(filter: ProductFilter, limit = 50) {
  return useInfiniteQuery({
    // The previous page stays on screen (dimmed) while a new filter or size loads.
    placeholderData: keepPreviousData,
    queryKey: queryKeys.inventory.products.list({ ...filter, limit }),
    queryFn: ({ pageParam }) => api.listProducts(filter, pageParam, limit),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.pagination.nextCursor,
    // A quick return to the tab reads nothing; a stock write refreshes it explicitly.
    staleTime: 30_000,
  });
}

/**
 * Скільки всього товарів під тими самими фільтрами — з цього панель робить
 * «Page 2 of 7». Сервер тримає число тридцять секунд, тож і тут стільки ж.
 */
export function useProductsCount(filter: ProductFilter) {
  return useQuery({
    // The previous page stays on screen (dimmed) while a new filter or size loads.
    placeholderData: keepPreviousData,
    queryKey: queryKeys.inventory.products.count(filter),
    queryFn: () => api.countProducts(filter),
    staleTime: 30_000,
  });
}

/**
 * One item. `seed`: start from its row in the Items list while the item is
 * read — for a view that only shows it (the stock popup's title and prices).
 * The Edit form does not: it waits for the item itself.
 */
export function useProduct(id: string, { seed = false }: { seed?: boolean } = {}) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: queryKeys.inventory.products.detail(id),
    queryFn: () => api.getProduct(id),
    placeholderData: seed ? () => rowFromLists<Product>(qc, "products", id) : undefined,
  });
}

/** One item's stock in every location the caller may see (the "Manage stock" popup). */
export function useProductStock(id: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.inventory.products.stock(id),
    queryFn: () => api.getProductStock(id),
    enabled,
  });
}

/**
 * Item categories and brands, archived ones included (`active: false`) — a
 * picker offers the active ones and still names an archived one an item has.
 * `enabled: false` for a caller without the catalog's view permission.
 */
export function useItemCategories(enabled = true) {
  return useQuery({
    queryKey: queryKeys.inventory.categories.list(),
    queryFn: api.listItemCategories,
    enabled,
    staleTime: 5 * 60 * 1000,
  });
}

export function useBrands(enabled = true) {
  return useQuery({
    queryKey: queryKeys.inventory.brands.list(),
    queryFn: api.listBrands,
    enabled,
    staleTime: 5 * 60 * 1000,
  });
}

/** Presigned download URL for a product's photo (only when it has one). */
export function useProductPhoto(id: string, hasPhoto: boolean) {
  return useQuery({
    queryKey: queryKeys.inventory.products.photo(id),
    queryFn: () => api.getPhotoDownloadUrl(id),
    enabled: hasPhoto,
    staleTime: 50 * 60 * 1000, // URL is valid ~1h
  });
}

function useInvalidateProducts() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: queryKeys.inventory.products.all() });
}

export function useCreateProduct() {
  const invalidate = useInvalidateProducts();
  return useMutation({
    mutationFn: (body: CreateProductValues) => api.createProduct(body),
    onSuccess: (p) => {
      invalidate();
      toast.success(`Item “${p.name}” created`);
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export function useUpdateProduct() {
  const invalidate = useInvalidateProducts();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: PatchProductValues }) =>
      api.updateProduct(id, body),
    onSuccess: () => {
      invalidate();
      toast.success("Item saved");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export function useArchiveProduct() {
  const invalidate = useInvalidateProducts();
  return useMutation({
    mutationFn: (id: string) => api.archiveProduct(id),
    onSuccess: () => {
      invalidate();
      toast.success("Item archived");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export function useReactivateProduct() {
  const invalidate = useInvalidateProducts();
  return useMutation({
    mutationFn: (id: string) => api.reactivateProduct(id),
    onSuccess: () => {
      invalidate();
      toast.success("Item restored");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

/**
 * Upload = presign → PUT bytes to S3 → "complete" (the server makes the
 * thumbnail) → refresh the item, its photo URL and the lists, whose rows
 * carry the thumbnail.
 */
export function useUploadPhoto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, file }: { id: string; file: File }) => {
      const { uploadUrl } = await api.getPhotoUploadUrl(id, file.type);
      await api.uploadPhotoBytes(uploadUrl, file);
      await api.completePhotoUpload(id);
    },
    onSuccess: (_d, { id }) => {
      qc.invalidateQueries({ queryKey: queryKeys.inventory.products.detail(id) });
      qc.invalidateQueries({ queryKey: queryKeys.inventory.products.photo(id) });
      // Every list (Items, Price Book), whatever its filter.
      qc.invalidateQueries({ queryKey: queryKeys.inventory.products.list().slice(0, 2) });
      toast.success("Photo updated");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export function useRemovePhoto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.removePhoto(id),
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: queryKeys.inventory.products.detail(id) });
      qc.invalidateQueries({ queryKey: queryKeys.inventory.products.photo(id) });
      // The lists' rows carry the thumbnail that just went.
      qc.invalidateQueries({ queryKey: queryKeys.inventory.products.list().slice(0, 2) });
      toast.success("Photo removed");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

/** Import (or dry-run preview). Only a real import invalidates + toasts. */
export function useImportProducts() {
  const invalidate = useInvalidateProducts();
  return useMutation({
    mutationFn: ({ file, dryRun }: { file: File; dryRun: boolean }) =>
      api.importProducts(file, dryRun),
    onSuccess: (result, { dryRun }) => {
      if (dryRun) return;
      invalidate();
      const parts = [`${result.created} created`, `${result.updated} updated`];
      if (result.errors.length) parts.push(`${result.errors.length} errors`);
      toast.success(`Import done — ${parts.join(", ")}`);
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export type { Product };
