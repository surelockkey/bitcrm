"use client";

import { useMemo } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { useAllLocations } from "@/features/inventory/stock/hooks";
import * as api from "./api";

/**
 * Скільки всього рядків під тими самими фільтрами — з цього панель робить
 * «Page 2 of 7». Сервер тримає число тридцять секунд, тож і тут стільки ж.
 */
export function useTransfersCount(filter: api.TransferFilter = {}) {
  return useQuery({
    queryKey: queryKeys.inventory.transfers.count(filter),
    queryFn: () => api.countTransfers(filter),
    staleTime: 30_000,
  });
}

/** One type or all of them, filtered on the server — the key carries the filter. */
export function useTransfers(filter: api.TransferFilter = {}, limit = 50) {
  return useInfiniteQuery({
    queryKey: queryKeys.inventory.transfers.list({ ...filter, limit }),
    queryFn: ({ pageParam }) => api.listTransfers(filter, pageParam, limit),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.pagination.nextCursor,
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
