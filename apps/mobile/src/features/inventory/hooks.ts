import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ApiError } from '../../lib/api/errors';
import { queryKeys } from '../../lib/api/query-keys';
import { getContainerStock, getMyContainer } from './api';
import { sortStock, summarizeStock, toStockRows, type StockSummary } from './lib';
import type { MyContainer, StockRow } from './types';

/** How long the van's contents are treated as fresh. */
const STOCK_STALE_MS = 60_000;

/**
 * The technician's own van, or `null` when the office has not given them one.
 *
 * `GET /inventory/containers/my` answers **404** for "no container assigned",
 * which is an answer rather than a failure — so it is caught here and becomes
 * data. Three things follow, and all three are the point:
 *
 *   - react-query never sees an error, so it never burns a technician's signal
 *     retrying a question the server has already settled;
 *   - "no van yet" is cached and written to disk with everything else, so it
 *     still reads "no van assigned" in a basement instead of "no signal";
 *   - a real failure stays a real failure and the screen can say so.
 */
export function useMyContainer() {
  const query = useQuery<MyContainer | null>({
    queryKey: queryKeys.inventory.containers.mine(),
    queryFn: async () => {
      try {
        return await getMyContainer();
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return null;
        throw err;
      }
    },
    staleTime: 5 * 60_000,
  });

  return {
    container: query.data ?? undefined,
    unassigned: query.data === null,
    isLoading: query.isPending,
    // Normalised to undefined: react-query says `null` for "no error", and a
    // caller writing `error !== undefined` would be wrong in the quiet case.
    error: query.error ?? undefined,
    refetch: () => void query.refetch(),
  };
}

export interface UseMyStockResult {
  container: MyContainer | undefined;
  /** Every part on the van, A–Z. The screen filters this by the search box. */
  rows: StockRow[];
  summary: StockSummary;
  /** True when the office has assigned no container to this technician. */
  unassigned: boolean;
  isLoading: boolean;
  isRefetching: boolean;
  error: unknown;
  /**
   * True when the rows on screen came off the disk cache and the last attempt
   * to refresh them failed — the screen says so rather than passing week-old
   * quantities off as current.
   */
  stale: boolean;
  refetch: () => void;
}

/**
 * Everything "My stock" shows: the van, and what is in it.
 *
 * Two requests, not fifty — the stock row carries the product's name, so the
 * list is readable without the catalog (see `lib.ts#toStockRows`). The second
 * waits on the first because only the container knows its own id.
 */
export function useMyStock(): UseMyStockResult {
  const { container, unassigned, isLoading: containerLoading, error: containerError, refetch: refetchContainer } =
    useMyContainer();
  const containerId = container?.id;

  const stockQuery = useQuery({
    queryKey: queryKeys.inventory.containers.stock(containerId ?? ''),
    queryFn: () => getContainerStock(containerId!),
    enabled: Boolean(containerId),
    staleTime: STOCK_STALE_MS,
    select: (items) => sortStock(toStockRows(items)),
  });

  const rows = stockQuery.data ?? [];
  const summary = useMemo(() => summarizeStock(rows), [rows]);

  return {
    container,
    rows,
    summary,
    unassigned,
    // Still finding out which van it is counts as loading: showing "empty van"
    // to a technician whose list is on its way is a lie they would act on.
    isLoading: containerLoading || (Boolean(containerId) && stockQuery.isPending),
    isRefetching: stockQuery.isRefetching,
    error: containerError ?? stockQuery.error ?? undefined,
    stale: Boolean(stockQuery.error) && rows.length > 0,
    refetch: () => {
      refetchContainer();
      void stockQuery.refetch();
    },
  };
}
