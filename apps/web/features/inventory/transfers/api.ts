import type { Transfer, PaginatedResponse } from "@bitcrm/types";
import { http, apiFetchPaginated } from "@/lib/api/http";

export function listTransfers(cursor?: string): Promise<PaginatedResponse<Transfer>> {
  const q = new URLSearchParams({ limit: "50" });
  if (cursor) q.set("cursor", cursor);
  return apiFetchPaginated<Transfer>(`/inventory/transfers?${q}`);
}

export function getTransfer(id: string): Promise<Transfer> {
  return http.get<Transfer>(`/inventory/transfers/${id}`);
}
