"use client";

import { useMemo } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { useProductMap } from "@/features/inventory/warehouses/hooks";
import { enrichStock, summarizeStock } from "@/features/inventory/warehouses/lib";
import * as api from "./api";

export function useContainersList(department?: string) {
  return useInfiniteQuery({
    queryKey: queryKeys.inventory.containers.list(department ?? "all"),
    queryFn: ({ pageParam }) => api.listContainers(department, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.pagination.nextCursor,
  });
}

export function useContainer(id: string) {
  return useQuery({
    queryKey: queryKeys.inventory.containers.detail(id),
    queryFn: () => api.getContainer(id),
  });
}

export function useContainerStock(id: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.inventory.containers.stock(id),
    queryFn: () => api.getContainerStock(id),
    enabled,
    staleTime: 30 * 1000,
  });
}

export function useMyContainer() {
  return useQuery({
    queryKey: queryKeys.inventory.containers.mine(),
    queryFn: () => api.getMyContainer(),
  });
}

export function useContainerTransfers(id: string) {
  return useInfiniteQuery({
    queryKey: queryKeys.inventory.containers.transfers(id),
    queryFn: ({ pageParam }) => api.listContainerTransfers(id, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.pagination.nextCursor,
  });
}

/** Container stock joined with the catalog — reuses the Warehouses join. */
export function useContainerStockView(id: string, enabled = true) {
  const stockQ = useContainerStock(id, enabled);
  const mapQ = useProductMap(enabled);

  const inStock = useMemo(
    () => (stockQ.data ?? []).filter((s) => s.quantity > 0),
    [stockQ.data],
  );
  const rows = useMemo(
    () => enrichStock(inStock, mapQ.data ?? new Map()),
    [inStock, mapQ.data],
  );
  const summary = useMemo(() => summarizeStock(rows), [rows]);

  return {
    rows,
    summary,
    isLoading: stockQ.isLoading || mapQ.isLoading,
    isError: stockQ.isError,
    joinReady: mapQ.isSuccess,
  };
}
