import type {
  Warehouse,
  StockItem,
  Product,
  PaginatedResponse,
  InventoryStatus,
  ListCount,
} from "@bitcrm/types";
import { http, apiFetchPaginated } from "@/lib/api/http";
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

async function fetchProducts(filter: Record<string, string>, cap: number): Promise<Product[]> {
  const all: Product[] = [];
  let cursor: string | undefined;
  do {
    const q = new URLSearchParams({ ...filter, limit: "100" });
    if (cursor) q.set("cursor", cursor);
    const page = await apiFetchPaginated<Product>(`/inventory/products?${q}`);
    all.push(...page.data);
    cursor = page.pagination.nextCursor;
  } while (cursor && all.length < cap);
  return all.slice(0, cap);
}

/** The whole catalog, services included — what the job and estimate item pickers offer. */
export function fetchAllProducts(): Promise<Product[]> {
  return fetchProducts({}, 5000);
}

