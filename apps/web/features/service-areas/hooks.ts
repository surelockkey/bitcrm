"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { ServiceArea } from "@bitcrm/types";
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

/**
 * The closest active area to a location — asked only once resolve has said
 * "outside every area", which is the one moment the question means anything.
 */
export function useNearestServiceArea(lat?: number, lng?: number, enabled = true) {
  const on = enabled && lat !== undefined && lng !== undefined;
  return useQuery({
    queryKey: queryKeys.serviceAreas.nearest({ lat, lng }),
    queryFn: () => api.nearestServiceArea({ lat, lng }),
    enabled: on,
    staleTime: 60_000,
  });
}

/** Where a job's area actually comes from, and what to send the API. */
export interface EffectiveServiceArea {
  /**
   * What create/update should carry: the hand-picked id, or the
   * nearest-area fallback. Undefined lets the backend auto-resolve — the
   * address is covered, and the server's answer is the authoritative one.
   */
  submitId?: string;
  source: "manual" | "resolved" | "nearest" | null;
  area: ServiceArea | null;
  /** Set for the nearest fallback: how far the address is from that area. */
  distanceMiles?: number;
  /** The area the address itself falls in — the hint under a manual pick. */
  resolvedArea: ServiceArea | null;
  isFetching: boolean;
}

/**
 * One answer for "which service area is this job in": a manual pick wins,
 * then the area containing the address, then the nearest one — a Nevada
 * address still needs a market to file the job under.
 */
export function useEffectiveServiceArea(
  lat?: number,
  lng?: number,
  manualId?: string,
): EffectiveServiceArea {
  const { data: areas } = useServiceAreas();
  const resolved = useResolvedServiceArea(lat, lng);
  const outside = resolved.isFetched && !resolved.data;
  const nearest = useNearestServiceArea(lat, lng, outside);

  const resolvedArea = resolved.data ?? null;
  if (manualId) {
    return {
      submitId: manualId,
      source: "manual",
      area: areas?.find((a) => a.id === manualId) ?? null,
      resolvedArea,
      isFetching: false,
    };
  }
  if (resolvedArea) {
    return { source: "resolved", area: resolvedArea, resolvedArea, isFetching: false };
  }
  if (outside && nearest.data) {
    return {
      submitId: nearest.data.area.id,
      source: "nearest",
      area: nearest.data.area,
      distanceMiles: nearest.data.distanceMiles,
      resolvedArea: null,
      isFetching: false,
    };
  }
  return {
    source: null,
    area: null,
    resolvedArea: null,
    isFetching: resolved.isFetching || nearest.isFetching,
  };
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
