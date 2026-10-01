"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { queryKeys } from "@/lib/query-keys";
import { getApiErrorMessage } from "@/lib/api/errors";
import * as api from "./api";

/* --------------------------------------------------------------- queries */

/**
 * The client-tag catalog. Read on nearly every deal/dispatch/technician screen to
 * resolve ids to names, so it's cached generously — the catalog changes rarely.
 */
export function useClientTags() {
  return useQuery({
    queryKey: queryKeys.clientTags.list(),
    queryFn: api.listClientTags,
    staleTime: 5 * 60_000,
  });
}

export function useClientTag(id: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.clientTags.detail(id),
    queryFn: () => api.getClientTag(id),
    enabled,
  });
}

/* ------------------------------------------------------------- mutations */

function useInvalidateClientTags() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: queryKeys.clientTags.all() });
}

export function useCreateClientTag() {
  const invalidate = useInvalidateClientTags();
  return useMutation({
    mutationFn: (body: unknown) => api.createClientTag(body),
    onSuccess: () => {
      invalidate();
      toast.success("Client tag created");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export function useUpdateClientTag(id: string) {
  const invalidate = useInvalidateClientTags();
  return useMutation({
    mutationFn: (body: unknown) => api.updateClientTag(id, body),
    onSuccess: () => {
      invalidate();
      toast.success("Client tag updated");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export function useDeleteClientTag() {
  const invalidate = useInvalidateClientTags();
  return useMutation({
    mutationFn: (id: string) => api.deleteClientTag(id),
    onSuccess: (res) => {
      invalidate();
      // The backend archives a type still in use rather than deleting it.
      toast.success(res.archived ? "Client tag archived (still in use)" : "Client tag deleted");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}
