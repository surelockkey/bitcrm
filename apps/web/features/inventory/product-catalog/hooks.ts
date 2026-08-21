"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { queryKeys } from "@/lib/query-keys";
import { getApiErrorMessage } from "@/lib/api/errors";
import * as api from "./api";

/* --------------------------------------------------------------- queries */

/** Brands change rarely and the product form reads them on every open. */
export function useBrands() {
  return useQuery({
    queryKey: queryKeys.inventory.brands.list(),
    queryFn: api.listBrands,
    staleTime: 5 * 60_000,
  });
}

export function useProductCategories() {
  return useQuery({
    queryKey: queryKeys.inventory.productCategories.list(),
    queryFn: api.listProductCategories,
    staleTime: 5 * 60_000,
  });
}

/* ------------------------------------------------------------- mutations */

function useInvalidateBrands() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: queryKeys.inventory.brands.all() });
}

function useInvalidateCategories() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: queryKeys.inventory.productCategories.all() });
    // Products carry a category, so their list can show a stale label.
    qc.invalidateQueries({ queryKey: queryKeys.inventory.products.all() });
  };
}

export function useCreateBrand() {
  const invalidate = useInvalidateBrands();
  return useMutation({
    mutationFn: (body: unknown) => api.createBrand(body),
    onSuccess: () => {
      invalidate();
      toast.success("Brand created");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export function useUpdateBrand(id: string) {
  const invalidate = useInvalidateBrands();
  return useMutation({
    mutationFn: (body: unknown) => api.updateBrand(id, body),
    onSuccess: () => {
      invalidate();
      toast.success("Brand updated");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

/** The list's inline Enable/Disable switch. */
export function useToggleBrand() {
  const invalidate = useInvalidateBrands();
  return useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      active ? api.reactivateBrand(id) : api.archiveBrand(id),
    onSuccess: (brand) => {
      invalidate();
      toast.success(`${brand.name} ${brand.status === "active" ? "enabled" : "disabled"}`);
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export function useCreateProductCategory() {
  const invalidate = useInvalidateCategories();
  return useMutation({
    mutationFn: (body: unknown) => api.createProductCategory(body),
    onSuccess: () => {
      invalidate();
      toast.success("Category created");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export function useUpdateProductCategory(id: string) {
  const invalidate = useInvalidateCategories();
  return useMutation({
    mutationFn: (body: unknown) => api.updateProductCategory(id, body),
    onSuccess: () => {
      invalidate();
      toast.success("Category updated");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

/**
 * Disabling cascades down the tree, so the toast reports how many categories
 * actually went with it — a parent can take a dozen children along.
 */
export function useToggleProductCategory() {
  const invalidate = useInvalidateCategories();
  return useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean; name?: string }) =>
      active
        ? api.reactivateProductCategory(id).then((c) => [c])
        : api.archiveProductCategory(id),
    onSuccess: (affected, vars) => {
      invalidate();
      const name = vars.name ?? "Category";
      if (vars.active) {
        toast.success(`${name} enabled`);
        return;
      }
      const nested = affected.length - 1;
      toast.success(
        nested > 0
          ? `${name} disabled, along with ${nested} nested ${nested === 1 ? "category" : "categories"}`
          : `${name} disabled`,
      );
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}
