"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { CustomFieldDefinition } from "@bitcrm/types";
import { queryKeys } from "@/lib/query-keys";
import { getApiErrorMessage } from "@/lib/api/errors";
import * as api from "./api";
import { clientCustomFields, jobCustomFields } from "./lib";

/* --------------------------------------------------------------- queries */

/**
 * The whole custom-field catalog — job AND client fields (Workiz's Job/Lead ·
 * Client tabs) — one request, cached generously: the catalog changes rarely.
 * Settings reads it whole; the job forms and the client card read their own
 * half through the hooks below, off the same cache entry.
 */
export function useAllCustomFields(enabled = true) {
  return useQuery({
    queryKey: queryKeys.customFields.list(),
    queryFn: api.listCustomFields,
    staleTime: 5 * 60_000,
    enabled,
  });
}

/**
 * The JOB custom fields — what every job form, column and filter reads. A
 * client field's answers live on the client, so it never reaches them.
 */
export function useCustomFields() {
  return useQuery({
    queryKey: queryKeys.customFields.list(),
    queryFn: api.listCustomFields,
    staleTime: 5 * 60_000,
    select: jobCustomFields,
  });
}

/** The CLIENT custom fields — the client card's Custom fields tab. */
export function useClientCustomFields(enabled = true) {
  return useQuery({
    queryKey: queryKeys.customFields.list(),
    queryFn: api.listCustomFields,
    staleTime: 5 * 60_000,
    select: clientCustomFields,
    enabled,
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

/**
 * A drag (or move up / down) in Settings → Custom Fields: write the priority
 * of every row that moved (`reorderPriorities`), one PUT each. The list takes
 * the new order at once and keeps it while the writes are out — a row that
 * jumped back and then forward again would read as a failed drop — and goes
 * back to the server's on a failure.
 */
export function useReorderCustomFields() {
  const qc = useQueryClient();
  const key = queryKeys.customFields.list();
  return useMutation({
    mutationFn: (changes: { id: string; priority: number }[]) =>
      Promise.all(changes.map((c) => api.updateCustomField(c.id, { priority: c.priority }))),
    onMutate: async (changes) => {
      await qc.cancelQueries({ queryKey: key });
      const before = qc.getQueryData<CustomFieldDefinition[]>(key);
      const next = new Map(changes.map((c) => [c.id, c.priority]));
      qc.setQueryData<CustomFieldDefinition[]>(key, (rows) =>
        rows?.map((f) => (next.has(f.id) ? { ...f, priority: next.get(f.id)! } : f)),
      );
      return { before };
    },
    onError: (e, _changes, context) => {
      if (context?.before) qc.setQueryData(key, context.before);
      toast.error(getApiErrorMessage(e));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.customFields.all() }),
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
