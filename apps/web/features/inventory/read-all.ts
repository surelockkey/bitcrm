import { apiFetchPaginated } from "@/lib/api/http";

/**
 * Every row an inventory list holds — for the helpers that need the whole of
 * one (pickers, the fleet's departments, names to join): page after page,
 * following the cursor to the end.
 *
 * The inventory service keeps `limit` now — one request with `limit=100`
 * answers 100 of the 209 containers on dev — so a helper that took one
 * answer for everything quietly lost the rest. A list endpoint that answers
 * whole (categories, brands, templates, user containers: no cursor) is one
 * request; should it start paging, this follows.
 */
export interface ReadAllOptions {
  /** Rows asked of each request; `null` sends no `limit` (an endpoint that answers whole). */
  pageSize?: number | null;
  /** A guard against a cursor that never ends — far above any real list (a million rows). */
  maxPages?: number;
}

export async function readAllPages<T>(
  path: string,
  params: Record<string, string> = {},
  { pageSize = 100, maxPages = 10_000 }: ReadAllOptions = {},
): Promise<T[]> {
  const all: T[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < maxPages; page += 1) {
    const q = new URLSearchParams(params);
    if (pageSize != null) q.set("limit", String(pageSize));
    if (cursor) q.set("cursor", cursor);
    const qs = q.toString();
    const body = await apiFetchPaginated<T>(qs ? `${path}?${qs}` : path);
    if (Array.isArray(body.data)) all.push(...body.data);
    cursor = body.pagination?.nextCursor;
    // The end — or a server handing the same cursor back, which would never end.
    if (!cursor || seen.has(cursor)) break;
    seen.add(cursor);
  }
  return all;
}
