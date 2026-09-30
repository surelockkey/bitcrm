import type {
  Container,
  InventoryStatus,
  StockItem,
  PaginatedResponse,
  ListCount,
} from "@bitcrm/types";
import { UserContainerAccess } from "@bitcrm/types";
import { http, apiFetchPaginated } from "@/lib/api/http";
import { ApiError } from "@/lib/api/errors";
import { getMyUserContainer } from "@/features/inventory/user-containers/api";

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

/** Who works from the van is set on User containers, not here. */
export interface CreateContainerBody {
  name: string;
  description?: string;
  department?: string;
  /** The van's ideal loadout. */
  templateId?: string;
}

/** `templateId: null` clears the template. */
export type UpdateContainerBody = Partial<
  Pick<Container, "name" | "description" | "department" | "status">
> & {
  templateId?: string | null;
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

/** The caller's van as the server resolves it — assignment row first, then the legacy link. 404 when none. */
export function getMyContainer(): Promise<Container> {
  return http.get<Container>("/inventory/containers/my");
}

const notFound = (e: unknown) => e instanceof ApiError && e.status === 404;

/**
 * The caller's own van. Their user-container row decides: the van it names,
 * or none at all for "All locations" and "No access" — even when an old van
 * still names them as its technician. Without a row, `/containers/my` finds
 * that legacy van. `null` — no van of their own.
 */
export async function fetchMyContainer(): Promise<Container | null> {
  let row;
  try {
    row = await getMyUserContainer();
  } catch (e) {
    if (!notFound(e)) throw e;
  }
  if (!row) return getMyContainer();
  if (row.access !== UserContainerAccess.CONTAINER || !row.containerId) return null;
  try {
    return await getContainer(row.containerId);
  } catch {
    // Opening a van by id may be off-limits to a technician; `/containers/my`
    // resolves the same row on the server and needs no permission.
    return getMyContainer();
  }
}
