import type { QueryClient } from "@tanstack/react-query";

/**
 * The row a list already holds for `id` — any loaded page of any filter under
 * `[root, "list"]`, else the pickers' whole list `[root, "everything"]`.
 *
 * A popup opened from a row starts from it (`placeholderData`) while the
 * fresh copy is read behind it: its title, its template and its form are
 * there on the first frame instead of a skeleton. Only for detail endpoints
 * that answer the same shape as the list does (same server mapper).
 */
export function rowFromLists<T extends { id: string }>(
  qc: QueryClient,
  root: string,
  id: string,
): T | undefined {
  for (const [, data] of qc.getQueriesData<{ pages?: { data?: T[] }[] }>({ queryKey: [root, "list"] })) {
    for (const page of data?.pages ?? []) {
      const hit = page.data?.find((row) => row.id === id);
      if (hit) return hit;
    }
  }
  return qc.getQueryData<T[]>([root, "everything"])?.find((row) => row.id === id);
}
