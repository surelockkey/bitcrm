"use client";

import { useCallback, useState } from "react";
import { useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import * as api from "./api";
import { useDashboardReady } from "./bundle-context";
import { DEFAULT_RANGE, localDay, rangeWindow, type DashboardRange } from "./jobs-by-status";

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
  const ready = useDashboardReady();
  const [rebuilding, setRebuilding] = useState(false);
  const query = useQuery({
    queryKey,
    queryFn: () => fetch(undefined),
    staleTime: SNAPSHOT_STALE_MS,
    gcTime: SNAPSHOT_GC_MS,
    enabled: ready,
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
  return {
    ...query,
    isLoading: query.isLoading || (!ready && query.data === undefined),
    isFetching: query.isFetching || rebuilding,
    refetch,
  };
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

/** A live widget: read as it is, but still held back while the bundle is on its way. */
function useLive<T>(queryKey: QueryKey, queryFn: () => Promise<T>) {
  const ready = useDashboardReady();
  const query = useQuery({ queryKey, queryFn, staleTime: 30_000, enabled: ready });
  return { ...query, isLoading: query.isLoading || (!ready && query.data === undefined) };
}

/** "Today", on the account's calendar — live, not a snapshot. */
export function useToday(now: Date) {
  const day = localDay(now);
  return useLive(queryKeys.dashboard.widget("today", day), () => api.getToday(day));
}

export function useJobsNow() {
  return useLive(queryKeys.dashboard.widget("jobs-now"), api.getJobsNow);
}

export function useRecentCalls() {
  return useLive(queryKeys.dashboard.widget("recent-calls"), api.getRecentCalls);
}

/**
 * The dashboard's opening read: two requests — one per service — instead of
 * one per card. Each answer is laid into the cache entry of the card that
 * shows it, under exactly the key that card's own hook asks with, so when the
 * cards are let go they find their data and paint together.
 *
 * The two services settle independently: one failing leaves the other's
 * cards filled, and the failed ones simply fetch on their own.
 */
export function useDashboardBundle(now: Date) {
  const client = useQueryClient();
  const window = rangeWindow(DEFAULT_RANGE, now);
  const day = localDay(now);
  return useQuery({
    queryKey: queryKeys.dashboard.widget("bundle", { window, day }),
    queryFn: async () => {
      const [deal, calls] = await Promise.allSettled([api.getDealBundle(window, day), api.getCallsBundle(window)]);
      const seed = (key: QueryKey, data: unknown) => {
        if (data !== undefined) client.setQueryData(key, data);
      };
      if (deal.status === "fulfilled") {
        const d = deal.value;
        seed(queryKeys.dashboard.widget("sales", window), d.sales);
        seed(queryKeys.dashboard.widget("top-sources", window), d.topSources);
        seed(queryKeys.dashboard.widget("top-job-types", window), d.topJobTypes);
        seed(queryKeys.dashboard.widget("service-areas", window), d.serviceAreas);
        seed(queryKeys.dashboard.widget("tech-scoreboard", window), d.techScoreboard);
        seed(queryKeys.dashboard.widget("dispatch-scoreboard", window), d.dispatchScoreboard);
        seed(queryKeys.dashboard.widget("today", day), d.today);
        seed(queryKeys.dashboard.widget("jobs-now"), d.jobsNow);
        seed(queryKeys.dashboard.jobsByStatus(window), d.jobsByStatus);
      }
      if (calls.status === "fulfilled") {
        seed(queryKeys.dashboard.widget("top-call-flows", window), calls.value.topCallFlows);
        seed(queryKeys.dashboard.widget("recent-calls"), calls.value.recentCalls);
      }
      return { at: Date.now() };
    },
    staleTime: SNAPSHOT_STALE_MS,
    gcTime: SNAPSHOT_GC_MS,
    retry: false,
  });
}
