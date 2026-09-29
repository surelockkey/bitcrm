"use client";

import { useMemo } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import { queryKeys } from "@/lib/query-keys";
import { getApiErrorMessage } from "@/lib/api/errors";
import * as api from "./api";
import type { WarehouseValues } from "./schemas";
import { enrichStock, summarizeStock } from "./lib";

export function useWarehousesList(filter: api.WarehouseFilter, limit = 100) {
  return useInfiniteQuery({
    queryKey: queryKeys.inventory.warehouses.list({ ...filter, limit }),
    queryFn: ({ pageParam }) => api.listWarehouses(filter, pageParam, limit),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.pagination.nextCursor,
  });
}

/**
 * Скільки всього рядків під тими самими фільтрами — з цього панель робить
 * «Page 2 of 7». Сервер тримає число тридцять секунд, тож і тут стільки ж.
 */
export function useWarehousesCount(filter: api.WarehouseFilter) {
  return useQuery({
    queryKey: queryKeys.inventory.warehouses.count(filter),
    queryFn: () => api.countWarehouses(filter),
    staleTime: 30_000,
  });
}

export function useWarehouse(id: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.inventory.warehouses.detail(id),
    queryFn: () => api.getWarehouse(id),
    enabled,
  });
}

export function useWarehouseStock(id: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.inventory.warehouses.stock(id),
    queryFn: () => api.getWarehouseStock(id),
    enabled,
    staleTime: 30 * 1000,
  });
}

/** Stock-managed items as an id→Product map, for the stock join. Cached hard. */
export function useProductMap(enabled = true) {
  return useQuery({
    queryKey: queryKeys.inventory.products.stockMap(),
    queryFn: async () => {
      const products = await api.fetchStockManagedProducts();
      return new Map(products.map((p) => [p.id, p] as const));
    },
    enabled,
    staleTime: 5 * 60 * 1000,
  });
}

/** Warehouse stock joined with the catalog: enriched rows + a summary. */
export function useWarehouseStockView(id: string, enabled = true) {
  const stockQ = useWarehouseStock(id, enabled);
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
    // The join is best-effort; a failed catalog fetch just drops enrichment.
    joinReady: mapQ.isSuccess,
    refetch: stockQ.refetch,
  };
}

export function useCreateWarehouse() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: WarehouseValues) => api.createWarehouse(body),
    onSuccess: (w) => {
      qc.invalidateQueries({ queryKey: queryKeys.inventory.warehouses.all() });
      toast.success(`Warehouse “${w.name}” created`);
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export function useUpdateWarehouse() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: WarehouseValues }) =>
      api.updateWarehouse(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.inventory.warehouses.all() });
      toast.success("Warehouse saved");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export function useArchiveWarehouse() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.archiveWarehouse(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.inventory.warehouses.all() });
      toast.success("Warehouse archived");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}
