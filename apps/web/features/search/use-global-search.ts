import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { globalSearch, type GlobalSearchParams } from "./api";

const MIN_QUERY_LENGTH = 2;

/**
 * Debounced typeahead search for the command palette. Only fires once the query
 * is stable and at least {@link MIN_QUERY_LENGTH} chars; keeps the previous page
 * of results visible while the next query is in flight (no flicker).
 */
export function useGlobalSearch(
  rawQuery: string,
  opts?: Pick<GlobalSearchParams, "mode" | "limit" | "types">,
) {
  const query = useDebouncedValue(rawQuery.trim(), 250);
  const enabled = query.length >= MIN_QUERY_LENGTH;
  const mode = opts?.mode ?? "typeahead";

  const result = useQuery({
    queryKey: queryKeys.search.global(query, mode),
    queryFn: () => globalSearch({ q: query, ...opts, mode }),
    enabled,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });

  return {
    ...result,
    /** True while the user has typed enough but results are still pending. */
    isSearching: enabled && result.isPending,
    /** True when the query is too short to search. */
    tooShort: rawQuery.trim().length > 0 && !enabled,
    query,
  };
}
