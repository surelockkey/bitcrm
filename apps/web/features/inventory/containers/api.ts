import type {
  Container,
  StockItem,
  Transfer,
  PaginatedResponse,
} from "@bitcrm/types";
import { LocationType } from "@bitcrm/types";
import { http, apiFetchPaginated } from "@/lib/api/http";

export function listContainers(
  department?: string,
  cursor?: string,
): Promise<PaginatedResponse<Container>> {
  const q = new URLSearchParams({ limit: "100" });
  if (department) q.set("department", department);
  if (cursor) q.set("cursor", cursor);
  return apiFetchPaginated<Container>(`/inventory/containers?${q}`);
}

export function getContainer(id: string): Promise<Container> {
  return http.get<Container>(`/inventory/containers/${id}`);
}

export function getContainerStock(id: string): Promise<StockItem[]> {
  return http.get<StockItem[]>(`/inventory/containers/${id}/stock`);
}

/** The current technician's own van (lazy-created server-side). */
export function getMyContainer(): Promise<Container> {
  return http.get<Container>("/inventory/containers/my");
}

/** Movement history for one container. */
export function listContainerTransfers(
  id: string,
  cursor?: string,
): Promise<PaginatedResponse<Transfer>> {
  const q = new URLSearchParams({ limit: "50" });
  if (cursor) q.set("cursor", cursor);
  return apiFetchPaginated<Transfer>(
    `/inventory/transfers/entity/${LocationType.CONTAINER}/${id}?${q}`,
  );
}
