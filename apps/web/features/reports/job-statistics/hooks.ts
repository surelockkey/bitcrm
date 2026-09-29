"use client";

import { useQuery } from "@tanstack/react-query";
import type { DealStats } from "@bitcrm/types";
import { http } from "@/lib/api/http";
import { queryKeys } from "@/lib/query-keys";
import { statsParams, type JobStatisticsFilters } from "./lib";

/** The report's figures; under the `deals` key, so the jobs live stream keeps them fresh. */
export function useJobStatistics(filters: JobStatisticsFilters) {
  const params = statsParams(filters);
  return useQuery({
    queryKey: queryKeys.deals.stats(params),
    queryFn: () => http.get<DealStats>(`/deals/stats?${new URLSearchParams(params)}`),
  });
}
