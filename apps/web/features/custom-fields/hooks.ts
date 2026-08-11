"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { queryKeys } from "@/lib/query-keys";
import { getApiErrorMessage } from "@/lib/api/errors";
import * as api from "./api";

/* --------------------------------------------------------------- queries */

/**
 * The custom-field catalog. Read on deal forms and Settings to resolve ids to
 * definitions, so it's cached generously — the catalog changes rarely.
 */
export function useCustomFields() {
  return useQuery({
    queryKey: queryKeys.customFields.list(),
    queryFn: api.listCustomFields,
    staleTime: 5 * 60_000,
  });
}

export function useCustomField(id: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.customFields.detail(id),
    queryFn: () => api.getCustomField(id),
    enabled,
  });
}

/* ------------------------------------------------------------- mutations */

function useInvalidateCustomFields() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: queryKeys.customFields.all() });
}

export function useCreateCustomField() {
  const invalidate = useInvalidateCustomFields();
  return useMutation({
    mutationFn: (body: unknown) => api.createCustomField(body),
    onSuccess: () => {
      invalidate();
      toast.success("Custom field created");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export function useUpdateCustomField(id: string) {
  const invalidate = useInvalidateCustomFields();
  return useMutation({
    mutationFn: (body: unknown) => api.updateCustomField(id, body),
    onSuccess: () => {
      invalidate();
      toast.success("Custom field updated");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export function useDeleteCustomField() {
  const invalidate = useInvalidateCustomFields();
  return useMutation({
    mutationFn: (id: string) => api.removeCustomField(id),
    onSuccess: (res) => {
      invalidate();
      // The backend archives a field still in use rather than deleting it.
      toast.success(
        res.archived
          ? "Custom field archived (still in use)"
          : "Custom field deleted",
      );
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}
