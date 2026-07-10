"use client";

import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import type { Product } from "@bitcrm/types";
import { queryKeys } from "@/lib/query-keys";
import { getApiErrorMessage } from "@/lib/api/errors";
import * as api from "./api";
import type { CreateProductValues, UpdateProductValues } from "./schemas";
import type { ProductFilter } from "./lib";

export function useProducts(filter: ProductFilter) {
  return useInfiniteQuery({
    queryKey: queryKeys.inventory.products.list(filter),
    queryFn: ({ pageParam }) => api.listProducts(filter, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.pagination.nextCursor,
  });
}

export function useProduct(id: string) {
  return useQuery({
    queryKey: queryKeys.inventory.products.detail(id),
    queryFn: () => api.getProduct(id),
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
      toast.success(`Product “${p.name}” created`);
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export function useUpdateProduct() {
  const invalidate = useInvalidateProducts();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateProductValues }) =>
      api.updateProduct(id, body),
    onSuccess: () => {
      invalidate();
      toast.success("Product saved");
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
      toast.success("Product archived");
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
      toast.success("Product restored");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

/** Upload = presign → PUT bytes to S3 → refresh detail + photo URL. */
export function useUploadPhoto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, file }: { id: string; file: File }) => {
      const { uploadUrl } = await api.getPhotoUploadUrl(id, file.type);
      await api.uploadPhotoBytes(uploadUrl, file);
    },
    onSuccess: (_d, { id }) => {
      qc.invalidateQueries({ queryKey: queryKeys.inventory.products.detail(id) });
      qc.invalidateQueries({ queryKey: queryKeys.inventory.products.photo(id) });
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
