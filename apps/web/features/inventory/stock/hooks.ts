"use client";

import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient, type Query } from "@tanstack/react-query";
import { toast } from "sonner";
import type { LocationSummaryType, Transfer } from "@bitcrm/types";
import { summarizeStock } from "@/features/inventory/warehouses/lib";
import { queryKeys } from "@/lib/query-keys";
import { getApiErrorMessage } from "@/lib/api/errors";
import * as api from "./api";
import { movementMessages, stockRowsOf, toLocations, type Movement } from "./lib";

/**
 * The item queries a movement changes: the list and the popup show `onHand`,
 * and `stock` is the per-location split. Not the rest of `products` — the
 * whole-catalog map the job pickers hold has nothing a movement touches, and
 * re-reading it is dozens of sequential requests.
 */
const movedByStock = ({ queryKey: [root, second, third] }: Query) =>
  root === "products" && (second === "list" || second === "detail" || third === "stock");

/** A movement changes the item, both locations, and the journal. */
function useStockMovement<B>(kind: Movement, send: (body: B) => Promise<Transfer>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: send,
    onSuccess: (t) => {
      qc.invalidateQueries({ predicate: movedByStock });
      qc.invalidateQueries({ queryKey: queryKeys.inventory.containers.all() });
      qc.invalidateQueries({ queryKey: queryKeys.inventory.warehouses.all() });
      qc.invalidateQueries({ queryKey: queryKeys.inventory.transfers.all() });
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

/**
 * One warehouse's or van's stock, in one request: named, priced and in name
 * order from the server. `name` and `status` come with it, so a popup needs
 * nothing else to title itself.
 */
export function useLocationStock(type: LocationSummaryType, id: string, enabled = true) {
  const query = useQuery({
    queryKey: queryKeys.inventory.locationStock(type, id),
    queryFn: () => api.getLocationStock(type, id),
    enabled: enabled && !!id,
    staleTime: 30 * 1000,
  });
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
