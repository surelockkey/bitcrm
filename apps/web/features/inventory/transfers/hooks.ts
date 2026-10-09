"use client";

import { useMemo } from "react";
import { keepPreviousData, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { useAllLocations } from "@/features/inventory/stock/hooks";
import * as api from "./api";

/**
 * Скільки всього рядків під тими самими фільтрами — з цього панель робить
 * «Page 2 of 7». Сервер тримає число тридцять секунд, тож і тут стільки ж.
 */
export function useTransfersCount(filter: api.TransferFilter = {}, enabled = true) {
  return useQuery({
    // The previous page stays on screen (dimmed) while a new filter or size loads.
    placeholderData: keepPreviousData,
    queryKey: queryKeys.inventory.transfers.count(filter),
    queryFn: () => api.countTransfers(filter),
    enabled,
    staleTime: 30_000,
  });
}

/** One type or all of them, filtered on the server — the key carries the filter. */
export function useTransfers(filter: api.TransferFilter = {}, limit = 50) {
  return useInfiniteQuery({
    // The previous page stays on screen (dimmed) while a new filter or size loads.
    placeholderData: keepPreviousData,
    queryKey: queryKeys.inventory.transfers.list({ ...filter, limit }),
    queryFn: ({ pageParam }) => api.listTransfers(filter, pageParam, limit),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.pagination.nextCursor,
    // A quick return to the tab reads nothing; a stock write refreshes it explicitly.
    staleTime: 30_000,
  });
}

export function useTransfer(id: string) {
  return useQuery({
    queryKey: queryKeys.inventory.transfers.detail(id),
    queryFn: () => api.getTransfer(id),
  });
}

/** id → display name for every warehouse and container, for route rendering. */
export function useLocationMap() {
  const locations = useAllLocations();
  const map = useMemo(
    () => new Map(locations.data.map((l) => [l.id, l.name] as const)),
    [locations.data],
  );
  return { map, isLoading: locations.isLoading };
}
