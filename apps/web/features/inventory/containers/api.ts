import type {
  Container,
  InventoryStatus,
  StockItem,
  Transfer,
  PaginatedResponse,
  ListCount,
} from "@bitcrm/types";
import { LocationType } from "@bitcrm/types";
import { http, apiFetchPaginated } from "@/lib/api/http";

/**
 * What the fleet list is narrowed by — on the server, before the page is cut,
 * so every page comes back full and the count agrees with it.
 */
export interface ContainerFilter {
  /** Matched against the name, case-insensitive. */
  search?: string;
  department?: string;
  status?: InventoryStatus;
}

function filterQuery(filter: ContainerFilter): URLSearchParams {
  const q = new URLSearchParams();
  if (filter.search) q.set("search", filter.search);
  if (filter.department) q.set("department", filter.department);
  if (filter.status) q.set("status", filter.status);
  return q;
}

export function listContainers(
  filter: ContainerFilter = {},
  cursor?: string,
  limit = 100,
): Promise<PaginatedResponse<Container>> {
  const q = filterQuery(filter);
  if (cursor) q.set("cursor", cursor);
  q.set("limit", String(limit));
  return apiFetchPaginated<Container>(`/inventory/containers?${q}`);
}

/** Скільки контейнерів під цим фільтром — число для «Page 2 of 7». */
export function countContainers(filter: ContainerFilter = {}): Promise<ListCount> {
  const s = filterQuery(filter).toString();
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
