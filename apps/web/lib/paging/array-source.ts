import type { PagedSource } from "./use-pager";

/**
 * A list held whole in the browser, as `usePager` pages — so it pages under
 * the same panel as a server list. Every page is already in hand.
 */
export function arraySource<T>(rows: T[], pageSize: number, isLoading = false): PagedSource<T> {
  const size = Math.max(1, pageSize);
  const pages: T[][] = [];
  for (let i = 0; i < rows.length; i += size) pages.push(rows.slice(i, i + size));
  return {
    pages,
    hasNextPage: false,
    isFetchingNextPage: false,
    isLoading,
    fetchNextPage: async () => undefined,
  };
}
