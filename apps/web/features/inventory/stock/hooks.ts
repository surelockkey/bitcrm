"use client";

import { useMemo } from "react";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { LocationSummaryType, Transfer } from "@bitcrm/types";
import { summarizeStock } from "@/features/inventory/warehouses/lib";
import { queryKeys } from "@/lib/query-keys";
import { getApiErrorMessage } from "@/lib/api/errors";
import * as api from "./api";
import { movementMessages, stockRowsOf, toLocations, type Movement } from "./lib";
import { refreshAfterMovement } from "./refresh";

/** A request body names its ends only where it has them: a receive has no source, a return no target. */
type Ends = { fromType?: string; fromId?: string; toType?: string; toId?: string; items?: { productId: string }[] };

/**
 * A movement changes two locations, the items it carried and the journal —
 * and `refreshAfterMovement` refreshes exactly that. The ends come from the
 * server's answer, else from the request.
 */
function useStockMovement<B>(kind: Movement, send: (body: B) => Promise<Transfer>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: send,
    onSuccess: (t, body) => {
      const asked = body as Ends;
      refreshAfterMovement(
        qc,
        [
          { type: t.fromType ?? asked.fromType, id: t.fromId ?? asked.fromId },
          { type: t.toType ?? asked.toType, id: t.toId ?? asked.toId },
        ],
        [...(t.items ?? []), ...(asked.items ?? [])].map((i) => i.productId),
      );
      const { success, warning } = movementMessages(kind, t);
      toast.success(success);
      if (warning) toast.warning(warning);
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export function useReceiveStock() {
  return useStockMovement("receive", api.receiveStock);
}

export function useMoveStock() {
  return useStockMovement("move", api.moveStock);
}

export function useReturnStock() {
  return useStockMovement("return", api.returnStock);
}

/**
 * Every warehouse and van the caller may see, paged to the end — for pickers
 * and for naming the two ends of a transfer. Each list stands on its own: a
 * technician without `warehouses.view` still gets the vans.
 */
export function useAllLocations(enabled = true) {
  const warehouses = useQuery({
    queryKey: queryKeys.inventory.warehouses.everything(),
    queryFn: api.fetchAllWarehouses,
    enabled,
    staleTime: 60_000,
  });
  const containers = useQuery({
    queryKey: queryKeys.inventory.containers.everything(),
    queryFn: api.fetchAllContainers,
    enabled,
    staleTime: 60_000,
  });

  const data = useMemo(
    () => toLocations(warehouses.data ?? [], containers.data ?? []),
    [warehouses.data, containers.data],
  );

  return {
    data,
    isLoading: warehouses.isLoading || containers.isLoading,
    isError: warehouses.isError && containers.isError,
  };
}

/** The read behind `useLocationStock` — shared with the template's Copy from location, so both fill one cache entry. */
export function locationStockQuery(type: LocationSummaryType, id: string) {
  return queryOptions({
    queryKey: queryKeys.inventory.locationStock(type, id),
    queryFn: () => api.getLocationStock(type, id),
    staleTime: 30 * 1000,
  });
}

/**
 * One warehouse's or van's stock, in one request: named, priced and in name
 * order from the server. `name` and `status` come with it, so a popup needs
 * nothing else to title itself.
 */
export function useLocationStock(type: LocationSummaryType, id: string, enabled = true) {
  const query = useQuery({ ...locationStockQuery(type, id), enabled: enabled && !!id });
  const rows = useMemo(() => stockRowsOf(query.data?.rows ?? []), [query.data]);
  const summary = useMemo(() => summarizeStock(rows), [rows]);

  return {
    name: query.data?.name,
    status: query.data?.status,
    rows,
    summary,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}
