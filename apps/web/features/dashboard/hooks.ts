"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import * as api from "./api";

/** The dashboard's period; kept fresh by the jobs live stream (its key is under `deals`). */
export function useDealStats(window: { from: string; to: string }, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.deals.stats(window),
    queryFn: () => api.getDealStats(window),
    enabled,
  });
}
