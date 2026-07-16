import type {
  Warehouse,
  StockItem,
  Transfer,
  TransferItem,
  Container,
  Product,
  PaginatedResponse,
} from "@bitcrm/types";
import { LocationType } from "@bitcrm/types";
import { http, apiFetchPaginated } from "@/lib/api/http";
import type { WarehouseValues } from "./schemas";

/* --- Warehouses --- */

export function listWarehouses(cursor?: string): Promise<PaginatedResponse<Warehouse>> {
  const q = new URLSearchParams({ limit: "100" });
  if (cursor) q.set("cursor", cursor);
  return apiFetchPaginated<Warehouse>(`/inventory/warehouses?${q}`);
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

/** Supplier → warehouse. Bumps stock and writes a Receive record. */
export function receiveStock(id: string, items: TransferItem[]): Promise<null> {
  return http.post<null>(`/inventory/warehouses/${id}/receive`, { items });
}

/* --- Transfers --- */

export interface CreateTransferBody {
  fromType: LocationType;
  fromId: string;
  toType: LocationType;
  toId: string;
  items: TransferItem[];
  notes?: string;
}

export function createTransfer(body: CreateTransferBody): Promise<Transfer> {
  return http.post<Transfer>("/inventory/transfers", body);
}

/** Movement history for one warehouse. */
export function listWarehouseTransfers(
  id: string,
  cursor?: string,
): Promise<PaginatedResponse<Transfer>> {
  const q = new URLSearchParams({ limit: "50" });
  if (cursor) q.set("cursor", cursor);
  return apiFetchPaginated<Transfer>(
    `/inventory/transfers/entity/${LocationType.WAREHOUSE}/${id}?${q}`,
  );
}

/* --- Containers (transfer targets) --- */

export function listContainers(cursor?: string): Promise<PaginatedResponse<Container>> {
  const q = new URLSearchParams({ limit: "100" });
  if (cursor) q.set("cursor", cursor);
  return apiFetchPaginated<Container>(`/inventory/containers?${q}`);
}

/* --- Product catalog (for the stock join) --- */

/** Page through the whole catalog once; cached and reused for the join. */
export async function fetchAllProducts(): Promise<Product[]> {
  const all: Product[] = [];
  let cursor: string | undefined;
  do {
    const q = new URLSearchParams({ limit: "100" });
    if (cursor) q.set("cursor", cursor);
    const page = await apiFetchPaginated<Product>(`/inventory/products?${q}`);
    all.push(...page.data);
    cursor = page.pagination.nextCursor;
  } while (cursor && all.length < 5000);
  return all;
}
