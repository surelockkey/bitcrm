import type {
  DocumentDiscount,
  Estimate,
  EstimateItem,
  EstimateStatus,
  EstimateWithItems,
  ListCount,
} from "@bitcrm/types";
import { http } from "@/lib/api/http";
import { buildEstimateListQuery, normalizeEstimateSummary, type EstimateListParams, type EstimateSummary } from "./lib";
import type { EstimateItemBody } from "./schemas";

const BASE = "/billing/estimates";

export interface EstimatePage {
  items: Estimate[];
  nextCursor?: string;
}

export interface EstimatePatch {
  name?: string;
  estimateDate?: string;
  notes?: string;
  templateId?: string | null;
  taxRateId?: string | null;
  discount?: DocumentDiscount | null;
}

export const listEstimates = (params: EstimateListParams = {}): Promise<EstimatePage> =>
  http.get<EstimatePage>(`${BASE}${buildEstimateListQuery(params)}`);

/**
 * Скільки естімейтів під цим фільтром — число для «Page 2 of 7». Для техніка,
 * що бачить лише свої роботи, сервер чесно повертає `total: null`.
 */
export const countEstimates = (params: EstimateListParams = {}): Promise<ListCount> =>
  http.get<ListCount>(`${BASE}/count${buildEstimateListQuery({ ...params, cursor: undefined })}`);

export async function fetchAllEstimates(params: Omit<EstimateListParams, "cursor"> = {}): Promise<Estimate[]> {
  const out: Estimate[] = [];
  let cursor: string | undefined;
  do {
    const page = await listEstimates({ ...params, limit: params.limit ?? 100, cursor });
    out.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor && out.length < 2000);
  return out;
}

export const getEstimateSummary = async (): Promise<EstimateSummary> =>
  normalizeEstimateSummary(await http.get<unknown>(`${BASE}/summary`));

export const getEstimatesByDeal = (dealId: string): Promise<EstimateWithItems[]> =>
  http.get<EstimateWithItems[]>(`${BASE}/by-deal/${dealId}`);

export const getEstimate = (id: string): Promise<EstimateWithItems> =>
  http.get<EstimateWithItems>(`${BASE}/${id}`);

export const createEstimate = (body: {
  dealId: string;
  name?: string;
  copyJobItems?: boolean;
}): Promise<EstimateWithItems> => http.post<EstimateWithItems>(BASE, body);

export const updateEstimate = (id: string, body: EstimatePatch): Promise<EstimateWithItems> =>
  http.patch<EstimateWithItems>(`${BASE}/${id}`, body);

export const setEstimateStatus = (id: string, status: EstimateStatus): Promise<Estimate> =>
  http.patch<Estimate>(`${BASE}/${id}/status`, { status });

export const addEstimateItem = (id: string, body: EstimateItemBody): Promise<EstimateItem> =>
  http.post<EstimateItem>(`${BASE}/${id}/items`, body);

export const updateEstimateItem = (id: string, lineId: string, body: EstimateItemBody): Promise<EstimateItem> =>
  http.put<EstimateItem>(`${BASE}/${id}/items/${lineId}`, body);

export const setEstimateItemTaxable = (id: string, lineId: string, taxable: boolean): Promise<EstimateItem> =>
  http.patch<EstimateItem>(`${BASE}/${id}/items/${lineId}/taxable`, { taxable });

export const deleteEstimateItem = (id: string, lineId: string): Promise<unknown> =>
  http.delete<unknown>(`${BASE}/${id}/items/${lineId}`);

export const reorderEstimateItems = (id: string, lineIds: string[]): Promise<unknown> =>
  http.put<unknown>(`${BASE}/${id}/items-order`, { lineIds });

export const duplicateEstimate = (id: string): Promise<EstimateWithItems> =>
  http.post<EstimateWithItems>(`${BASE}/${id}/duplicate`);

export const syncEstimateToJob = (id: string): Promise<{ estimate: EstimateWithItems; itemCount: number }> =>
  http.post<{ estimate: EstimateWithItems; itemCount: number }>(`${BASE}/${id}/sync-to-job`);

export const markEstimateSent = (id: string, sent: boolean): Promise<Estimate> =>
  http.post<Estimate>(`${BASE}/${id}/mark-sent`, { sent });

export const deleteEstimate = (id: string): Promise<unknown> => http.delete<unknown>(`${BASE}/${id}`);

export const getEstimatePdfUrl = (id: string, download = false): Promise<{ url: string }> =>
  http.get<{ url: string }>(`${BASE}/${id}/pdf${download ? "?download=1" : ""}`);

export const getEstimateHtml = (id: string): Promise<{ html: string }> =>
  http.get<{ html: string }>(`${BASE}/${id}/html`);
