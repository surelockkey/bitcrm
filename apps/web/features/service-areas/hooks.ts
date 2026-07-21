"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { queryKeys } from "@/lib/query-keys";
import { getApiErrorMessage } from "@/lib/api/errors";
import * as api from "./api";

/* --------------------------------------------------------------- queries */

export function useServiceAreas(enabled = true) {
  return useQuery({
    queryKey: queryKeys.serviceAreas.list(),
    queryFn: api.listServiceAreas,
    enabled,
  });
}

export function useServiceArea(id: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.serviceAreas.detail(id),
    queryFn: () => api.getServiceArea(id),
    enabled,
  });
}

/**
 * Which catalog area contains this location — the same auto-resolve the backend
 * runs on deal create, surfaced in the form so dispatch sees it before saving.
 * Only queries once both coordinates are present.
 */
export function useResolvedServiceArea(lat?: number, lng?: number) {
  const enabled = lat !== undefined && lng !== undefined;
  return useQuery({
    queryKey: queryKeys.serviceAreas.resolve({ lat, lng }),
    queryFn: () => api.resolveServiceArea({ lat, lng }),
    enabled,
    staleTime: 60_000,
  });
}

/* ------------------------------------------------------------- mutations */

function useInvalidateServiceAreas() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: queryKeys.serviceAreas.all() });
}

export function useCreateServiceArea() {
  const invalidate = useInvalidateServiceAreas();
  return useMutation({
    mutationFn: (body: unknown) => api.createServiceArea(body),
    onSuccess: () => {
      invalidate();
      toast.success("Service area created");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export function useUpdateServiceArea(id: string) {
  const invalidate = useInvalidateServiceAreas();
  return useMutation({
    mutationFn: (body: unknown) => api.updateServiceArea(id, body),
    onSuccess: () => {
      invalidate();
      toast.success("Service area updated");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export function useDeleteServiceArea() {
  const invalidate = useInvalidateServiceAreas();
  return useMutation({
    mutationFn: (id: string) => api.deleteServiceArea(id),
    onSuccess: () => {
      invalidate();
      toast.success("Service area deleted");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}
