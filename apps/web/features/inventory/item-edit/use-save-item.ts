"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { Product } from "@bitcrm/types";
import { queryKeys } from "@/lib/query-keys";
import { getApiErrorMessage } from "@/lib/api/errors";
import * as api from "@/features/inventory/products/api";
import type {
  CreateProductValues,
  PatchProductValues,
  ProductExtrasBody,
} from "@/features/inventory/products/schemas";
import type { PhotoChange } from "./photo-field";

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
      body: CreateProductValues & ProductExtrasBody;
      photo: PhotoChange;
    };

async function applyPhoto(id: string, photo: PhotoChange, hadPhoto: boolean): Promise<void> {
  if (photo.file) {
    const { uploadUrl } = await api.getPhotoUploadUrl(id, photo.file.type || "image/jpeg");
    await api.uploadPhotoBytes(uploadUrl, photo.file);
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
        const created = await api.createProduct(job.body);
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
    onError: (e) => toast.error(getApiErrorMessage(e)),
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
