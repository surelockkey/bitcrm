import type {
  Deal,
  DealProduct,
  DealStage,
  TimelineEntry,
  PaginatedResponse,
} from "@bitcrm/types";
import { http, apiFetchPaginated } from "@/lib/api/http";
import type { CreateDealValues, UpdateDealValues, AddProductValues } from "./schemas";

const PAGE = 100;

/**
 * A candidate for a job: identity, what they're approved for, and how far their
 * home is from the address.
 *
 * Mirrors what deal-service actually returns — it has no email and no job count,
 * whatever the earlier shape claimed. `distanceMiles` is null until both the deal
 * address and the technician's home carry coordinates.
 */
export interface QualifiedTech {
  id: string;
  firstName?: string;
  lastName?: string;
  department?: string;
  skills?: string[];
  serviceAreas?: string[];
  distanceMiles?: number | null;
}

/* -------------------------------------------------------------------- list */

export function listDeals(
  params: { stage?: DealStage; techId?: string; cursor?: string } = {},
): Promise<PaginatedResponse<Deal>> {
  const q = new URLSearchParams({ limit: String(PAGE) });
  if (params.stage) q.set("stage", params.stage);
  if (params.techId) q.set("techId", params.techId);
  if (params.cursor) q.set("cursor", params.cursor);
  return apiFetchPaginated<Deal>(`/deals?${q}`);
}

/**
 * Walk every page. The list barely filters server-side and has no text search,
 * so we load the active set and filter/search/group client-side. A scan page
 * can be empty while a cursor still exists — loop until `nextCursor` is gone.
 */
export async function fetchAllDeals(
  params: { stage?: DealStage; techId?: string } = {},
): Promise<Deal[]> {
  const out: Deal[] = [];
  let cursor: string | undefined;
  do {
    const page = await listDeals({ ...params, cursor });
    out.push(...page.data);
    cursor = page.pagination.nextCursor;
  } while (cursor);
  return out;
}

/* ------------------------------------------------------------------- deal */

export const getDeal = (id: string): Promise<Deal> => http.get<Deal>(`/deals/${id}`);

export const createDeal = (body: CreateDealValues): Promise<Deal> =>
  http.post<Deal>("/deals", body);

export const updateDeal = (id: string, body: UpdateDealValues): Promise<Deal> =>
  http.put<Deal>(`/deals/${id}`, body);

export const deleteDeal = (id: string): Promise<{ id: string; deleted: true }> =>
  http.delete<{ id: string; deleted: true }>(`/deals/${id}`);

/* ------------------------------------------------------------------ stage */

export const changeStage = (
  id: string,
  stage: DealStage,
  cancellationReason?: string,
): Promise<Deal> => http.put<Deal>(`/deals/${id}/stage`, { stage, cancellationReason });

export const getAllowedStages = (id: string): Promise<DealStage[]> =>
  http.get<DealStage[]>(`/deals/${id}/allowed-stages`);

/* --------------------------------------------------------------- timeline */

export function getTimeline(id: string, cursor?: string): Promise<PaginatedResponse<TimelineEntry>> {
  const q = new URLSearchParams({ limit: "30" });
  if (cursor) q.set("cursor", cursor);
  return apiFetchPaginated<TimelineEntry>(`/deals/${id}/timeline?${q}`);
}

export const addNote = (id: string, note: string): Promise<{ added: true }> =>
  http.post<{ added: true }>(`/deals/${id}/notes`, { note });

/* ------------------------------------------------------------- assignment */

export const getQualifiedTechs = (id: string): Promise<QualifiedTech[]> =>
  http.get<QualifiedTech[]>(`/deals/${id}/qualified-techs`);

export const assignTech = (id: string, techId: string): Promise<Deal> =>
  http.post<Deal>(`/deals/${id}/assign`, { techId });

export const unassignTech = (id: string): Promise<Deal> =>
  http.post<Deal>(`/deals/${id}/unassign`, {});

/** Persist a manual job order for a technician (story 4.02). */
export const reorderDeals = (techId: string, orderedDealIds: string[]): Promise<{ ok: true }> =>
  http.post<{ ok: true }>(`/deals/reorder`, { techId, orderedDealIds });

/* --------------------------------------------------------------- products */

export const getDealProducts = (id: string): Promise<DealProduct[]> =>
  http.get<DealProduct[]>(`/deals/${id}/products`);

export const addDealProduct = (id: string, body: AddProductValues): Promise<{ added: true }> =>
  http.post<{ added: true }>(`/deals/${id}/products`, body);

export const removeDealProduct = (
  id: string,
  productId: string,
): Promise<{ removed: true }> =>
  http.delete<{ removed: true }>(`/deals/${id}/products/${productId}`);
