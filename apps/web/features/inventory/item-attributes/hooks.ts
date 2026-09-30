"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { queryKeys } from "@/lib/query-keys";
import { getApiErrorMessage } from "@/lib/api/errors";
import * as api from "./api";

/** The custom field catalog's cache entry. */
export const itemAttributesKey = ["item-attributes", "list"] as const;

/** The item custom fields (definitions). `enabled: false` without `products.view`. */
export function useItemAttributes(enabled = true) {
  return useQuery({
    queryKey: itemAttributesKey,
    queryFn: api.listItemAttributes,
    enabled,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * A definition change is made at once, the way Workiz makes it — not with the
 * item's Save. A rename or delete also rewrote the items holding a value, so
 * their cached copies are refreshed too.
 */
function useInvalidate() {
  const qc = useQueryClient();
  return (items: boolean) => {
    qc.invalidateQueries({ queryKey: itemAttributesKey });
    if (items) qc.invalidateQueries({ queryKey: queryKeys.inventory.products.all() });
  };
}

export function useCreateItemAttribute() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (body: api.ItemAttributeBody) => api.createItemAttribute(body),
    onSuccess: (a) => {
      invalidate(false);
      toast.success(`Custom field “${a.name}” added`);
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export function useUpdateItemAttribute() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<api.ItemAttributeBody> }) =>
      api.updateItemAttribute(id, body),
    onSuccess: (a) => {
      invalidate(a.productsUpdated > 0);
      toast.success(`Custom field “${a.name}” saved`);
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export function useDeleteItemAttribute() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id }: { id: string; name: string }) => api.deleteItemAttribute(id),
    onSuccess: (r, { name }) => {
      invalidate(r.productsUpdated > 0);
      toast.success(`Custom field “${name}” deleted`);
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}
