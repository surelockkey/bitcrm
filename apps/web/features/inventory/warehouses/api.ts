import { InventoryStatus } from "@bitcrm/types";
import type { Warehouse, StockItem, Product, PaginatedResponse, ListCount } from "@bitcrm/types";
import { http, apiFetchPaginated } from "@/lib/api/http";
import { readAllPages } from "@/features/inventory/read-all";
import type { WarehouseValues } from "./schemas";

/* --- Warehouses --- */

/** Narrowed on the server, before the page is cut. */
export interface WarehouseFilter {
  /** Matched against the name, case-insensitive. */
  search?: string;
  status?: InventoryStatus;
}

function filterQuery(filter: WarehouseFilter): URLSearchParams {
  const q = new URLSearchParams();
  if (filter.search) q.set("search", filter.search);
  if (filter.status) q.set("status", filter.status);
  return q;
}

export function listWarehouses(
  filter: WarehouseFilter = {},
  cursor?: string,
  limit = 100,
): Promise<PaginatedResponse<Warehouse>> {
  const q = filterQuery(filter);
  if (cursor) q.set("cursor", cursor);
  q.set("limit", String(limit));
  return apiFetchPaginated<Warehouse>(`/inventory/warehouses?${q}`);
}

/** Скільки складів під цим фільтром — число для «Page 2 of 7». */
export function countWarehouses(filter: WarehouseFilter = {}): Promise<ListCount> {
  const s = filterQuery(filter).toString();
  return http.get<ListCount>(`/inventory/warehouses/count${s ? `?${s}` : ""}`);
}

export function getWarehouse(id: string): Promise<Warehouse> {
  return http.get<Warehouse>(`/inventory/warehouses/${id}`);
}

export function createWarehouse(body: WarehouseValues): Promise<Warehouse> {
  return http.post<Warehouse>("/inventory/warehouses", body);
}

export function updateWarehouse(id: string, body: WarehouseValues): Promise<Warehouse> {
  return http.put<Warehouse>(`/inventory/warehouses/${id}`, body);
}

export function archiveWarehouse(id: string): Promise<Warehouse> {
  return http.delete<Warehouse>(`/inventory/warehouses/${id}`);
}

export function getWarehouseStock(id: string): Promise<StockItem[]> {
  return http.get<StockItem[]>(`/inventory/warehouses/${id}/stock`);
}

/* --- Product catalog --- */

/**
 * Every active item — products and services — what the job and estimate item
 * pickers offer. Read to the end of the cursor: the catalog is ~7 300 active
 * items of ~16 000 on dev, and the old read stopped at 5 000 of all of them
 * (active and archived, in name order), so the pickers never offered an item
 * past the first third of the alphabet. Archived items were thrown away by
 * both pickers anyway; asking the server for the active ones halves the read.
 */
export function fetchAllProducts(): Promise<Product[]> {
  return readAllPages<Product>("/inventory/products", { status: InventoryStatus.ACTIVE });
}
