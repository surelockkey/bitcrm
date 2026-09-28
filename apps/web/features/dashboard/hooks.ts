"use client";

import { useCallback, useState } from "react";
import { useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import * as api from "./api";
import { localDay, rangeWindow, type DashboardRange } from "./jobs-by-status";

/**
 * The server builds these snapshots once a night, so the browser has no
 * reason to ask again every thirty seconds: an answer is kept fresh for five
 * minutes and in memory for half an hour. Coming back to the dashboard paints
 * from memory at once instead of fetching.
 */
const SNAPSHOT_STALE_MS = 5 * 60_000;
const SNAPSHOT_GC_MS = 30 * 60_000;

/**
 * A widget read from a server snapshot. `refetch` — the card's refresh button
 * — asks the server to rebuild it (`refresh=1`) and puts the answer in the
 * cache, so the button means "count again", not "fetch the same snapshot".
 */
function useSnapshot<T>(queryKey: QueryKey, fetch: (opts?: api.SnapshotRequest) => Promise<T>) {
  const client = useQueryClient();
  const [rebuilding, setRebuilding] = useState(false);
  const query = useQuery({
    queryKey,
    queryFn: () => fetch(undefined),
    staleTime: SNAPSHOT_STALE_MS,
    gcTime: SNAPSHOT_GC_MS,
  });
  const key = JSON.stringify(queryKey);
  const refetch = useCallback(async () => {
    setRebuilding(true);
    try {
      client.setQueryData(JSON.parse(key) as QueryKey, await fetch({ refresh: true }));
    } finally {
      setRebuilding(false);
    }
    // `fetch` is a module-level function per widget; the key names the window.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, key]);
  return { ...query, isFetching: query.isFetching || rebuilding, refetch };
}

/**
 * Серія для «Jobs By Status».
 *
 * Вікно рахується з `now`, яке передає картка, а не береться всередині: інакше
 * кожен рендер давав би новий ключ кешу, і графік перезапитувався б без кінця.
 */
export function useJobsByStatus(range: DashboardRange, now: Date) {
  const window = rangeWindow(range, now);
  return useSnapshot(queryKeys.dashboard.jobsByStatus(window), (opts) => api.getJobsByStatus(window, opts));
}

/**
 * Any "Last N Days" widget: its name picks the cache entry, `fetch` the route.
 * The same frozen-`now` rule as above.
 */
export function useRangeWidget<T>(
  name: string,
  fetch: (window: api.DayWindow, opts?: api.SnapshotRequest) => Promise<T>,
  range: DashboardRange,
  now: Date,
) {
  const window = rangeWindow(range, now);
  return useSnapshot(queryKeys.dashboard.widget(name, window), (opts) => fetch(window, opts));
}

/** "Today", on the account's calendar — live, not a snapshot. */
export function useToday(now: Date) {
  const day = localDay(now);
  return useQuery({
    queryKey: queryKeys.dashboard.widget("today", day),
    queryFn: () => api.getToday(day),
    staleTime: 30_000,
  });
}

export function useJobsNow() {
  return useQuery({
    queryKey: queryKeys.dashboard.widget("jobs-now"),
    queryFn: api.getJobsNow,
    staleTime: 30_000,
  });
}

export function useRecentCalls() {
  return useQuery({
    queryKey: queryKeys.dashboard.widget("recent-calls"),
    queryFn: api.getRecentCalls,
    staleTime: 30_000,
  });
}
