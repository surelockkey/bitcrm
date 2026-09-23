import type {
  Deal,
  DealProduct,
  DocumentDiscount,
  DocumentTotals,
  JobSuperStatus,
  SendToTechChannel,
  TimelineEntry,
  PaginatedResponse,
} from "@bitcrm/types";
import { http, apiFetchPaginated } from "@/lib/api/http";
import type { CreateDealValues, UpdateDealValues, AddProductValues } from "./schemas";
import type { DealCountsParams, DealsListParams } from "./query-params";

/** One number per super-status plus the undated open jobs; `null` where the server would not count. */
export type DealCounts = Record<JobSuperStatus, number | null> & { unscheduled: number };

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

/**
 * One page of the jobs list, as the server orders it. Every parameter is
 * optional and only the ones given travel; the server refuses a visit-date
 * window wider than 31 days.
 */
export function listDeals(params: DealsListParams = {}): Promise<PaginatedResponse<Deal>> {
  const q = toSearchParams({ limit: PAGE, ...params });
  return apiFetchPaginated<Deal>(`/deals?${q}`);
}

/** The numbers on the jobs-list tabs, under the list's filters. A closed status without a window is `null`. */
export const getDealCounts = (params: DealCountsParams = {}): Promise<DealCounts> => {
  const q = toSearchParams(params);
  return http.get<DealCounts>(q.size ? `/deals/counts?${q}` : "/deals/counts");
};

/** Hydrate a set of ids (a search result) in one call; the ones the caller may not see are absent. */
export const getDealsByIds = (ids: string[]): Promise<Deal[]> =>
  ids.length ? http.post<Deal[]>("/deals/by-ids", { ids }) : Promise.resolve([]);

/** Only the parameters that carry a value make it onto the wire. */
function toSearchParams(params: Record<string, string | number | boolean | undefined>): URLSearchParams {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === "" || v === false) continue;
    q.set(k, String(v));
  }
  return q;
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

/* ------------------------------------------------------- technician flow */

/**
 * "I've got it" — the old CRM's *Confirmed job receipt*. Stamps the caller's
 * assignment row and the job, so dispatch can see the technician has read it.
 * Idempotent server-side: a second tap returns the first stamp.
 */
export const confirmJobReceipt = (id: string): Promise<Deal> =>
  http.post<Deal>(`/deals/${id}/tech/confirm`, {});

export interface MarkArrivedBody {
  lat?: number;
  lng?: number;
  accuracy?: number;
  /** Catalog sub-status to apply; omitted, the server picks the arrival one. */
  subStatusId?: string;
}

/** "I'm here" — the old CRM's *Arrived at location*, with the phone's fix when it offered one. */
export const markArrived = (id: string, body: MarkArrivedBody = {}): Promise<Deal> =>
  http.post<Deal>(`/deals/${id}/tech/arrived`, body);

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
  jobTypeId?: string;
  serviceAreaId?: string;
  lat?: number;
  lng?: number;
}): Promise<QualifiedTech[]> => {
  const q = new URLSearchParams();
  if (params.jobTypeId) q.set("jobTypeId", params.jobTypeId);
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

/* ------------------------------------------------------- send to tech / seen */

/** What messaging-service reported for one (technician, channel) of a send. */
export interface SentToTechDelivery {
  status: "sent" | "skipped" | "failed";
  /** The click this delivery belongs to. */
  sentAt: string;
  at: string;
  /** Why nothing went out — `no_phone`, `no_email`, `email_not_configured`, … */
  reason?: string;
  messageId?: string;
  conversationId?: string;
}

/**
 * One technician's row on a job: roster membership plus the Workiz
 * per-technician "sent" / "seen" stamps (`GET /deals/:id/assignments`).
 */
export interface DealAssignment {
  dealId: string;
  techId: string;
  assignedBy?: string;
  assignedAt?: string;
  scheduledDate?: string;
  /** The latest "Send to tech" that included this technician. */
  sentAt?: string;
  sentVia?: SendToTechChannel[];
  sentBy?: string;
  /** First time they opened the job in their app (sticky). */
  seenAt?: string;
  deliveries?: Partial<Record<SendToTechChannel, SentToTechDelivery>>;
}

export interface SendToTechBody {
  channels: SendToTechChannel[];
  /** Narrows the roster; omitted = everyone assigned. */
  techIds?: string[];
}

/** Workiz "Send to tech" — stamps the job and hands it to messaging. `deals.edit`. */
export const sendToTech = (id: string, body: SendToTechBody): Promise<Deal> =>
  http.post<Deal>(`/deals/${id}/send-to-tech`, body);

export const getDealAssignments = (id: string): Promise<DealAssignment[]> =>
  http.get<DealAssignment[]>(`/deals/${id}/assignments`);

/**
 * Workiz `seen` / "Viewed job in app": the technician's app on open. Only an
 * assigned technician counts — anyone else is answered `seen: false` without
 * a write, so it is safe to call blindly.
 */
export const markDealSeen = (
  id: string,
): Promise<{ seen: boolean; seenAt?: string; first: boolean }> =>
  http.post<{ seen: boolean; seenAt?: string; first: boolean }>(`/deals/${id}/seen`);

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

/* ------------------------------------------------------------ tax/totals */

/** Server-computed totals (subtotal → discount → tax → total) for a job. */
export const getDealTotals = (id: string): Promise<DocumentTotals> =>
  http.get<DocumentTotals>(`/deals/${id}/totals`);

/** Pick the job's tax rate by hand (`null` = no tax); taxSource → `manual`. */
export const setDealTax = (id: string, taxRateId: string | null): Promise<Deal> =>
  http.patch<Deal>(`/deals/${id}/tax`, { taxRateId });

/** Re-resolve the tax automatically: exempt → service area → default → none. */
export const resetDealTaxAuto = (id: string): Promise<Deal> =>
  http.post<Deal>(`/deals/${id}/tax/auto`);

/** Set (or clear with `null`) the job-level discount. */
export const setDealDiscount = (id: string, discount: DocumentDiscount | null): Promise<Deal> =>
  http.patch<Deal>(`/deals/${id}/discount`, { discount });

/** Toggle whether the job's tax applies to one line. */
export const setDealProductTaxable = (
  id: string,
  productId: string,
  taxable: boolean,
): Promise<DealProduct> =>
  http.patch<DealProduct>(`/deals/${id}/products/${productId}/taxable`, { taxable });
