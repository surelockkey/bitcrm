import type { PagedSource } from "./use-pager";

interface InfiniteQueryLike<P> {
  data?: { pages: P[] };
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  isLoading: boolean;
  fetchNextPage: () => Promise<unknown>;
}

/**
 * `useInfiniteQuery` → `usePager`.
 *
 * Сторінка сервісу — це рядки плюс курсор; рядки майже скрізь лежать у
 * `data`, у білінгу — в `items`, тож звідки їх брати, можна сказати другим
 * аргументом.
 */
export function pagedSource<T>(query: InfiniteQueryLike<{ data: T[] }>): PagedSource<T>;
export function pagedSource<T, P>(
  query: InfiniteQueryLike<P>,
  rows: (page: P) => T[],
): PagedSource<T>;
export function pagedSource<T, P>(
  query: InfiniteQueryLike<P>,
  rows?: (page: P) => T[],
): PagedSource<T> {
  const take = rows ?? ((page: P) => (page as { data: T[] }).data);
  return {
    pages: query.data?.pages.map(take) ?? [],
    hasNextPage: query.hasNextPage,
    isFetchingNextPage: query.isFetchingNextPage,
    isLoading: query.isLoading,
    fetchNextPage: query.fetchNextPage,
  };
}
