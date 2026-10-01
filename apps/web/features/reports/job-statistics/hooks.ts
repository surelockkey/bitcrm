"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { JobStatistics } from "@bitcrm/types";
import { http } from "@/lib/api/http";

/** The report's own key — not under `deals`, so the jobs live stream does not re-read a period on every edit. */
export const jobStatisticsKeys = {
  report: (params: string) => ["reports", "job-statistics", params] as const,
};

/**
 * The period's figures (`GET /deals/report/statistics`). The previous answer
 * stays on screen while the next one loads, so the page does not blink on a
 * filter tick; the server keeps the window a minute, and so does this.
 */
export function useJobStatistics(params: string) {
  return useQuery({
    queryKey: jobStatisticsKeys.report(params),
    queryFn: () => http.get<JobStatistics>(`/deals/report/statistics?${params}`),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
}
