import type { SearchResponse, SearchType } from "@bitcrm/types";
import { http } from "@/lib/api/http";

export interface GlobalSearchParams {
  q: string;
  mode?: "typeahead" | "full";
  /** typeahead: hits per type. */
  limit?: number;
  /** full: filter to these entity types. */
  types?: SearchType[];
  /** full: 1-based page. */
  page?: number;
  /** full: page size. */
  size?: number;
}

/**
 * Global search across every entity. Results are already permission-filtered by
 * the backend to what the caller may view. The `{ success, data }` envelope is
 * unwrapped by `http.get`, so this resolves to the bare `SearchResponse`.
 */
export function globalSearch(params: GlobalSearchParams): Promise<SearchResponse> {
  const q = new URLSearchParams({ q: params.q, mode: params.mode ?? "typeahead" });
  if (params.limit != null) q.set("limit", String(params.limit));
  if (params.types?.length) q.set("type", params.types.join(","));
  if (params.page != null) q.set("page", String(params.page));
  if (params.size != null) q.set("size", String(params.size));
  return http.get<SearchResponse>(`/search?${q}`);
}
