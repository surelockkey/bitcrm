"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import {
  useContainers,
  useProductMap,
  useWarehouses,
} from "@/features/inventory/warehouses/hooks";
import { getWarehouseStock } from "@/features/inventory/warehouses/api";
import { getContainerStock } from "@/features/inventory/containers/api";
import { toLocationRows, summarizeStockValue, type LocationRow } from "./lib";

/** Warehouses and vans, merged into the single list the screen renders. */
export function useLocations() {
  const warehousesQ = useWarehouses();
  const containersQ = useContainers();

  // Both endpoints page; these hooks ask for the first 100 of each, which is
  // the whole fleet today.
  const rows: LocationRow[] = useMemo(
    () => toLocationRows(warehousesQ.data?.data, containersQ.data?.data),
    [warehousesQ.data, containersQ.data],
  );

  return {
    rows,
    isLoading: warehousesQ.isLoading || containersQ.isLoading,
    isError: warehousesQ.isError && containersQ.isError,
  };
}

export interface ManagedStockRow {
  productId: string;
  name: string;
  sku?: string;
  quantity: number;
  /** What we sell it for. */
  price: number;
  /** What it cost us. */
  cost: number;
  isLow: boolean;
}

/**
 * One location's stock, joined with the catalog for SKU, price and cost.
 *
 * The stock endpoint differs by kind, so the query is keyed by kind too —
 * otherwise a warehouse and a van with the same id would share a cache slot.
 */
export function useLocationStockView(location?: Pick<LocationRow, "kind" | "id">) {
  const id = location?.id ?? "";
  const isWarehouse = location?.kind === "warehouse";

  const stockQ = useQuery({
    queryKey: isWarehouse
      ? queryKeys.inventory.warehouses.stock(id)
      : queryKeys.inventory.containers.stock(id),
    queryFn: () => (isWarehouse ? getWarehouseStock(id) : getContainerStock(id)),
    enabled: Boolean(location),
    staleTime: 30_000,
  });
  const mapQ = useProductMap(Boolean(location));

  const rows: ManagedStockRow[] = useMemo(() => {
    const products = mapQ.data ?? new Map();
    return (stockQ.data ?? [])
      .filter((s) => s.quantity > 0)
      .map((s) => {
        const product = products.get(s.productId);
        const minLevel = product?.minimumStockLevel ?? 0;
        return {
          productId: s.productId,
          name: product?.name ?? s.productName,
          sku: product?.sku,
          quantity: s.quantity,
          price: product?.priceClient ?? 0,
          cost: product?.costCompany ?? 0,
          isLow: minLevel > 0 && s.quantity <= minLevel,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [stockQ.data, mapQ.data]);

  const totals = useMemo(() => summarizeStockValue(rows), [rows]);

  return {
    rows,
    totals,
    isLoading: stockQ.isLoading || mapQ.isLoading,
    isError: stockQ.isError,
  };
}
