import type { Transfer, PaginatedResponse, ListCount } from "@bitcrm/types";
import { http, apiFetchPaginated } from "@/lib/api/http";

export function listTransfers(cursor?: string, limit = 50): Promise<PaginatedResponse<Transfer>> {
  const q = new URLSearchParams({ limit: String(limit) });
  if (cursor) q.set("cursor", cursor);
  return apiFetchPaginated<Transfer>(`/inventory/transfers?${q}`);
}

/** Скільки трансферів — число для «Page 2 of 7». */
export function countTransfers(): Promise<ListCount> {
  return http.get<ListCount>("/inventory/transfers/count");
}

export function getTransfer(id: string): Promise<Transfer> {
  return http.get<Transfer>(`/inventory/transfers/${id}`);
}
