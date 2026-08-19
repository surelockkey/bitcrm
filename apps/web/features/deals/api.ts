import type {
  Deal,
  DealProduct,
  JobSuperStatus,
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
/** Why a technician doesn't qualify for a deal (empty when eligible). */
export type IneligibilityReason = "not_assignable" | "missing_job_type" | "outside_area";

export interface QualifiedTech {
  id: string;
  firstName?: string;
  lastName?: string;
  department?: string;
  jobTypeIds?: string[];
  serviceAreaIds?: string[];
  /** True when approved for this deal's job type AND service area. */
  eligible: boolean;
  reasons: IneligibilityReason[];
  distanceMiles?: number | null;
}

/* -------------------------------------------------------------------- list */

export function listDeals(
  params: { superStatus?: JobSuperStatus; techId?: string; cursor?: string } = {},
): Promise<PaginatedResponse<Deal>> {
  const q = new URLSearchParams({ limit: String(PAGE) });
  if (params.superStatus) q.set("superStatus", params.superStatus);
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
  params: { superStatus?: JobSuperStatus; techId?: string } = {},
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

/** Move a job to a different client. Guarded by deals.edit. */
export const changeDealClient = (id: string, contactId: string): Promise<Deal> =>
  http.put<Deal>(`/deals/${id}/client`, { contactId });

export const deleteDeal = (id: string): Promise<{ id: string; deleted: true }> =>
  http.delete<{ id: string; deleted: true }>(`/deals/${id}`);

/* ----------------------------------------------------------------- status */

export interface MoveStatusBody {
  superStatus: JobSuperStatus;
  subStatusId?: string;
  cancellationReason?: string;
}

/** Move a deal's status (super-status + optional sub-status). Guarded by deals.move_status. */
export const moveStatus = (id: string, body: MoveStatusBody): Promise<Deal> =>
  http.put<Deal>(`/deals/${id}/status`, body);

/* --------------------------------------------------------------- timeline */

export function getTimeline(id: string, cursor?: string): Promise<PaginatedResponse<TimelineEntry>> {
  const q = new URLSearchParams({ limit: "30" });
  if (cursor) q.set("cursor", cursor);
  return apiFetchPaginated<TimelineEntry>(`/deals/${id}/timeline?${q}`);
}

export const addNote = (id: string, note: string): Promise<{ added: true }> =>
  http.post<{ added: true }>(`/deals/${id}/notes`, { note });

/** The entry timestamp is part of the DynamoDB key, so it rides along. */
export const updateNote = (
  id: string,
  entryId: string,
  body: { note: string; timestamp: string },
): Promise<{ updated: true }> =>
  http.patch<{ updated: true }>(`/deals/${id}/notes/${entryId}`, body);

export const deleteNote = (
  id: string,
  entryId: string,
  timestamp: string,
): Promise<{ deleted: true }> =>
  http.delete<{ deleted: true }>(
    `/deals/${id}/notes/${entryId}?timestamp=${encodeURIComponent(timestamp)}`,
  );

/* ------------------------------------------------------------- assignment */

export const getQualifiedTechs = (id: string): Promise<QualifiedTech[]> =>
  http.get<QualifiedTech[]>(`/deals/${id}/qualified-techs`);

/** Suggest techs for a not-yet-created job, by job type + service area (+ point). */
export const suggestQualifiedTechs = (params: {
  jobTypeId: string;
  serviceAreaId?: string;
  lat?: number;
  lng?: number;
}): Promise<QualifiedTech[]> => {
  const q = new URLSearchParams({ jobTypeId: params.jobTypeId });
  if (params.serviceAreaId) q.set("serviceAreaId", params.serviceAreaId);
  if (params.lat !== undefined) q.set("lat", String(params.lat));
  if (params.lng !== undefined) q.set("lng", String(params.lng));
  return http.get<QualifiedTech[]>(`/deals/qualified-techs?${q}`);
};

/** Set the full technician roster on a job (diffed server-side). */
export const assignTechs = (id: string, techIds: string[]): Promise<Deal> =>
  http.post<Deal>(`/deals/${id}/assign`, { techIds });

/** Remove one technician from a job. */
export const unassignTech = (id: string, techId: string): Promise<Deal> =>
  http.post<Deal>(`/deals/${id}/unassign`, { techId });

/** Persist a manual job order for a technician (story 4.02). */
export const reorderDeals = (techId: string, orderedDealIds: string[]): Promise<{ ok: true }> =>
  http.post<{ ok: true }>(`/deals/reorder`, { techId, orderedDealIds });

/* --------------------------------------------------------------- products */

export const getDealProducts = (id: string): Promise<DealProduct[]> =>
  http.get<DealProduct[]>(`/deals/${id}/products`);

export const addDealProduct = (id: string, body: AddProductValues): Promise<{ added: true }> =>
  http.post<{ added: true }>(`/deals/${id}/products`, body);

/**
 * Replace a line item — edit its quantity/price or swap it for a different
 * catalog product. `productId` keys the line being edited; the body is the
 * complete new line (same shape as add). Stock is reconciled server-side.
 */
export const replaceDealProduct = (
  id: string,
  productId: string,
  body: AddProductValues,
): Promise<{ updated: true }> =>
  http.put<{ updated: true }>(`/deals/${id}/products/${productId}`, body);

export const removeDealProduct = (
  id: string,
  productId: string,
): Promise<{ removed: true }> =>
  http.delete<{ removed: true }>(`/deals/${id}/products/${productId}`);

/** Mark a to-order line as ordered (or clear it). */
export const markDealProductOrdered = (
  id: string,
  productId: string,
  ordered: boolean,
): Promise<{ ordered: boolean }> =>
  http.patch<{ ordered: boolean }>(
    `/deals/${id}/products/${productId}/ordered`,
    { ordered },
  );
