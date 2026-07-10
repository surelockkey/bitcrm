"use client";

import { useMemo } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import type {
  Warehouse,
  Container,
  StockItem,
  PaginatedResponse,
} from "@bitcrm/types";
import { http, apiFetchPaginated } from "@/lib/api/http";

/*
 * Product stock lives per-location (warehouse/container), not on the product.
 * With no per-product aggregate endpoint yet, we read the location lists and
 * fan out one stock query each, then keep the rows that hold this product.
 * (A future `GET /products/:id/stock` would collapse this to ~3 requests.)
 */

function listWarehouses(): Promise<PaginatedResponse<Warehouse>> {
  return apiFetchPaginated<Warehouse>("/inventory/warehouses?limit=100");
}
function listContainers(): Promise<PaginatedResponse<Container>> {
  return apiFetchPaginated<Container>("/inventory/containers?limit=100");
}
function getWarehouseStock(id: string): Promise<StockItem[]> {
  return http.get<StockItem[]>(`/inventory/warehouses/${id}/stock`);
}
function getContainerStock(id: string): Promise<StockItem[]> {
  return http.get<StockItem[]>(`/inventory/containers/${id}/stock`);
}

export interface ProductStockRow {
  id: string;
  name: string;
  subtitle?: string;
  kind: "warehouse" | "container";
  quantity: number;
}

export interface ProductStock {
  rows: ProductStockRow[];
  total: number;
  loading: boolean;
  listsLoading: boolean;
  isError: boolean;
  isEmpty: boolean;
}

export function useProductStock(productId: string, enabled: boolean): ProductStock {
  const warehousesQ = useQuery({
    queryKey: ["warehouses", "list-all"],
    queryFn: listWarehouses,
    enabled,
    staleTime: 60 * 1000,
  });
  const containersQ = useQuery({
    queryKey: ["containers", "list-all"],
    queryFn: listContainers,
    enabled,
    staleTime: 60 * 1000,
  });

  const locations = useMemo(() => {
    const w = (warehousesQ.data?.data ?? []).map((x) => ({
      id: x.id,
      name: x.name,
      subtitle: undefined as string | undefined,
      kind: "warehouse" as const,
    }));
    const c = (containersQ.data?.data ?? []).map((x) => ({
      id: x.id,
      name: x.technicianName || "Container",
      subtitle: x.department || undefined,
      kind: "container" as const,
    }));
    return [...w, ...c];
  }, [warehousesQ.data, containersQ.data]);

  const listsReady = enabled && warehousesQ.isSuccess && containersQ.isSuccess;

  const combined = useQueries({
    queries: locations.map((loc) => ({
      queryKey: ["location-stock", loc.kind, loc.id],
      queryFn: () =>
        loc.kind === "warehouse"
          ? getWarehouseStock(loc.id)
          : getContainerStock(loc.id),
      enabled: listsReady,
      staleTime: 60 * 1000,
    })),
    combine: (results) => {
      const rows: ProductStockRow[] = [];
      results.forEach((r, i) => {
        const loc = locations[i];
        const item = r.data?.find((s) => s.productId === productId);
        if (item && item.quantity > 0) {
          rows.push({ ...loc, quantity: item.quantity });
        }
      });
      rows.sort((a, b) => b.quantity - a.quantity);
      return {
        rows,
        total: rows.reduce((n, r) => n + r.quantity, 0),
        loading: results.some((r) => r.isLoading || r.isPending),
      };
    },
  });

  return {
    rows: combined.rows,
    total: combined.total,
    loading: !listsReady || combined.loading,
    listsLoading: warehousesQ.isLoading || containersQ.isLoading,
    isError: warehousesQ.isError || containersQ.isError,
    isEmpty: listsReady && !combined.loading && combined.rows.length === 0,
  };
}
