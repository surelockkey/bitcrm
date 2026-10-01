"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { Product } from "@bitcrm/types";
import { queryKeys } from "@/lib/query-keys";
import { ApiError, getApiErrorMessage } from "@/lib/api/errors";
import * as api from "@/features/inventory/products/api";
import type { CreateProductValues, PatchProductValues } from "@/features/inventory/products/schemas";
import type { CreateItemBody } from "./item-form";
import type { PhotoChange } from "./photo-field";

/** The API refused the SKU because another item has it (409). */
export function isSkuTaken(error: unknown): boolean {
  return error instanceof ApiError && error.status === 409 && /\bSKU\b/i.test(error.message);
}

/** What the SKU field says when the SKU is taken. */
export const SKU_TAKEN = "Another item already uses this SKU";

export type SaveItemJob =
  | {
      kind: "update";
      product: Product;
      body: PatchProductValues;
      photo: PhotoChange;
      /** "Enable item" flipped: true restores the item, false archives it. */
      active?: boolean;
    }
  | {
      kind: "create";
      body: CreateItemBody;
      photo: PhotoChange;
    };

async function applyPhoto(id: string, photo: PhotoChange, hadPhoto: boolean): Promise<void> {
  if (photo.file) {
    const { uploadUrl } = await api.getPhotoUploadUrl(id, photo.file.type || "image/jpeg");
    await api.uploadPhotoBytes(uploadUrl, photo.file);
    // the list's 40×40 thumbnail is made server-side from the uploaded bytes
    await api.completePhotoUpload(id);
  } else if (photo.remove && hadPhoto) {
    await api.removePhoto(id);
  }
}

/**
 * The popup's Save, in one go: the item's fields (only what changed), then the
 * photo, then "Enable item". One toast for the lot; on a failure the popup
 * stays open with what the user typed.
 */
export function useSaveItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (job: SaveItemJob): Promise<Product> => {
      if (job.kind === "create") {
        // The SKU may be left out: the API gives the item an internal one.
        const created = await api.createProduct(job.body as CreateProductValues);
        await applyPhoto(created.id, job.photo, false);
        return created;
      }
      const { product } = job;
      let saved = product;
      if (Object.keys(job.body).length > 0) saved = await api.updateProduct(product.id, job.body);
      await applyPhoto(product.id, job.photo, !!product.photoKey);
      if (job.active === true) saved = await api.reactivateProduct(product.id);
      if (job.active === false) saved = await api.archiveProduct(product.id);
      return saved;
    },
    onSuccess: (saved, job) => {
      qc.invalidateQueries({ queryKey: queryKeys.inventory.products.all() });
      toast.success(job.kind === "create" ? `Item “${saved.name}” created` : "Item saved");
    },
    // A taken SKU is said under the SKU field (the popup shows it), not in a toast.
    onError: (e) => {
      if (!isSkuTaken(e)) toast.error(getApiErrorMessage(e));
    },
  });
}

/**
 * Price Book "Delete Item". BitCRM keeps every item a job or estimate may
 * name, so the item is archived — the same as switching "Enable item" off —
 * and can be switched back on.
 */
export function useDeleteItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.archiveProduct(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.inventory.products.all() });
      toast.success("Item archived");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}
