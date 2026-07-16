"use client";

import { useMemo } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import type { TransferItem } from "@bitcrm/types";
import { queryKeys } from "@/lib/query-keys";
import { getApiErrorMessage } from "@/lib/api/errors";
import * as api from "./api";
import type { CreateTransferBody } from "./api";
import type { WarehouseValues } from "./schemas";
import { enrichStock, summarizeStock } from "./lib";

export function useWarehouses() {
  return useQuery({
    queryKey: queryKeys.inventory.warehouses.list(),
    queryFn: () => api.listWarehouses(),
    staleTime: 60 * 1000,
  });
}

export function useWarehouse(id: string) {
  return useQuery({
    queryKey: queryKeys.inventory.warehouses.detail(id),
    queryFn: () => api.getWarehouse(id),
  });
}

export function useWarehouseStock(id: string) {
  return useQuery({
    queryKey: queryKeys.inventory.warehouses.stock(id),
    queryFn: () => api.getWarehouseStock(id),
    staleTime: 30 * 1000,
  });
}

export function useWarehouseTransfers(id: string) {
  return useInfiniteQuery({
    queryKey: queryKeys.inventory.warehouses.transfers(id),
    queryFn: ({ pageParam }) => api.listWarehouseTransfers(id, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.pagination.nextCursor,
  });
}

export function useContainers(enabled = true) {
  return useQuery({
    queryKey: queryKeys.inventory.containers.list(),
    queryFn: () => api.listContainers(),
    enabled,
    staleTime: 60 * 1000,
  });
}

/** The whole catalog as an id→Product map, for the stock join. Cached hard. */
export function useProductMap(enabled = true) {
  return useQuery({
    queryKey: queryKeys.inventory.products.map(),
    queryFn: async () => {
      const products = await api.fetchAllProducts();
      return new Map(products.map((p) => [p.id, p] as const));
    },
    enabled,
    staleTime: 5 * 60 * 1000,
  });
}

/** Warehouse stock joined with the catalog: enriched rows + a summary. */
export function useWarehouseStockView(id: string, enabled = true) {
  const stockQ = useWarehouseStock(id);
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
  };
}

function useInvalidateInventory() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: queryKeys.inventory.warehouses.all() });
    qc.invalidateQueries({ queryKey: queryKeys.inventory.containers.all() });
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

export function useReceiveStock() {
  const invalidate = useInvalidateInventory();
  return useMutation({
    mutationFn: ({ id, items }: { id: string; items: TransferItem[] }) =>
      api.receiveStock(id, items),
    onSuccess: (_d, { items }) => {
      invalidate();
      const units = items.reduce((n, i) => n + i.quantity, 0);
      toast.success(`Received ${units} ${units === 1 ? "unit" : "units"}`);
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export function useCreateTransfer() {
  const invalidate = useInvalidateInventory();
  return useMutation({
    mutationFn: (body: CreateTransferBody) => api.createTransfer(body),
    onSuccess: () => {
      invalidate();
      toast.success("Stock transferred");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}
