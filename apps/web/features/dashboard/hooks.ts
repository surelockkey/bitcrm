"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import * as api from "./api";
import { rangeWindow, type DashboardRange } from "./jobs-by-status";

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
