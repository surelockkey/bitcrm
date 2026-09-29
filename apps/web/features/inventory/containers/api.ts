import type {
  Container,
  StockItem,
  Transfer,
  PaginatedResponse,
  ListCount,
} from "@bitcrm/types";
import { LocationType } from "@bitcrm/types";
import { http, apiFetchPaginated } from "@/lib/api/http";

export function listContainers(
  department?: string,
  cursor?: string,
  limit = 100,
): Promise<PaginatedResponse<Container>> {
  const q = new URLSearchParams({ limit: String(limit) });
  if (department) q.set("department", department);
  if (cursor) q.set("cursor", cursor);
  return apiFetchPaginated<Container>(`/inventory/containers?${q}`);
}

/** Скільки контейнерів під цим фільтром — число для «Page 2 of 7». */
export function countContainers(department?: string): Promise<ListCount> {
  const q = new URLSearchParams();
  if (department) q.set("department", department);
  const s = q.toString();
  return http.get<ListCount>(`/inventory/containers/count${s ? `?${s}` : ""}`);
}

export function getContainer(id: string): Promise<Container> {
  return http.get<Container>(`/inventory/containers/${id}`);
}

export interface CreateContainerBody {
  name: string;
  description?: string;
  department?: string;
  technicianId?: string;
  technicianName?: string;
}

/** `technicianId: null` unassigns the technician. */
export type UpdateContainerBody = Partial<
  Pick<Container, "name" | "description" | "department" | "status">
> & {
  technicianId?: string | null;
  technicianName?: string | null;
};

export function createContainer(body: CreateContainerBody): Promise<Container> {
  return http.post<Container>("/inventory/containers", body);
}

export function updateContainer(
  id: string,
  body: UpdateContainerBody,
): Promise<Container> {
  return http.put<Container>(`/inventory/containers/${id}`, body);
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
