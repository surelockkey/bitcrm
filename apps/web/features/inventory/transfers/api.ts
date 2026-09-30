import type { Transfer, TransferType, PaginatedResponse, ListCount } from "@bitcrm/types";
import { http, apiFetchPaginated } from "@/lib/api/http";

/** What the journal is narrowed by — on the server, the page and its count alike. */
export interface TransferFilter {
  type?: TransferType;
}

function filterQuery(filter: TransferFilter): URLSearchParams {
  const q = new URLSearchParams();
  if (filter.type) q.set("type", filter.type);
  return q;
}

export function listTransfers(
  filter: TransferFilter = {},
  cursor?: string,
  limit = 50,
): Promise<PaginatedResponse<Transfer>> {
  const q = filterQuery(filter);
  q.set("limit", String(limit));
  if (cursor) q.set("cursor", cursor);
  return apiFetchPaginated<Transfer>(`/inventory/transfers?${q}`);
}

/** Скільки трансферів під цим фільтром — число для «Page 2 of 7». */
export function countTransfers(filter: TransferFilter = {}): Promise<ListCount> {
  const s = filterQuery(filter).toString();
  return http.get<ListCount>(`/inventory/transfers/count${s ? `?${s}` : ""}`);
}

export function getTransfer(id: string): Promise<Transfer> {
  return http.get<Transfer>(`/inventory/transfers/${id}`);
}
