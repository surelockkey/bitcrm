import type { PagedSource } from "./use-pager";

/** Сторінка списку, як її віддають сервіси: рядки плюс курсор у `pagination`. */
interface ServicePage<T> {
  data: T[];
}

interface InfiniteQueryLike<T> {
  data?: { pages: ServicePage<T>[] };
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  isLoading: boolean;
  fetchNextPage: () => Promise<unknown>;
}

/**
 * `useInfiniteQuery` → `usePager`. Списки всіх сервісів приходять однаково
 * (`{ data, pagination }`), тож перехідник один на всі сторінки.
 */
export function pagedSource<T>(query: InfiniteQueryLike<T>): PagedSource<T> {
  return {
    pages: query.data?.pages.map((p) => p.data) ?? [],
    hasNextPage: query.hasNextPage,
    isFetchingNextPage: query.isFetchingNextPage,
    isLoading: query.isLoading,
    fetchNextPage: query.fetchNextPage,
  };
}
