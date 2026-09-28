"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import * as api from "./api";
import { localDay, rangeWindow, type DashboardRange } from "./jobs-by-status";

/**
 * Серія для «Jobs By Status».
 *
 * Вікно рахується з `now`, яке передає картка, а не береться всередині: інакше
 * кожен рендер давав би новий ключ кешу, і графік перезапитувався б без кінця.
 */
export function useJobsByStatus(range: DashboardRange, now: Date) {
  const window = rangeWindow(range, now);
  return useQuery({
    queryKey: queryKeys.dashboard.jobsByStatus(window),
    queryFn: () => api.getJobsByStatus(window),
    staleTime: 30_000,
  });
}

/**
 * Any "Last N Days" widget: its name picks the cache entry, `fetch` the route.
 * The same frozen-`now` rule as above.
 */
export function useRangeWidget<T>(
  name: string,
  fetch: (window: api.DayWindow) => Promise<T>,
  range: DashboardRange,
  now: Date,
) {
  const window = rangeWindow(range, now);
  return useQuery({
    queryKey: queryKeys.dashboard.widget(name, window),
    queryFn: () => fetch(window),
    staleTime: 30_000,
  });
}

/** "Today", for the viewer's own calendar day. */
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
