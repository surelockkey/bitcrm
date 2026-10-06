"use client";

import { keepPreviousData, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import type { ActivityExport, ActivityRow, ListCount } from "@bitcrm/types";
import { apiFetchPaginated, http } from "@/lib/api/http";
import { queryKeys } from "@/lib/query-keys";
import { activityParams, type ActivityFilter } from "./lib";

/** Pages of the journal, walked on the server's cursor. */
export function useActivity(filter: ActivityFilter, limit: number, enabled = true) {
  return useInfiniteQuery({
    queryKey: queryKeys.activity.list({ ...filter, limit }),
    queryFn: ({ pageParam }) =>
      apiFetchPaginated<ActivityRow>(`/deals/activity?${activityParams(filter, { limit, cursor: pageParam })}`),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.pagination.nextCursor,
    placeholderData: keepPreviousData,
    enabled,
  });
}

/**
 * "of N" — the server keeps it a minute. A new filter keeps the old total on
 * screen until its own is in, as the rows do, rather than blanking it.
 */
export function useActivityCount(filter: ActivityFilter, enabled = true) {
  return useQuery({
    queryKey: queryKeys.activity.count(filter),
    queryFn: () => http.get<ListCount>(`/deals/activity/count?${activityParams(filter)}`),
    staleTime: 60_000,
    placeholderData: keepPreviousData,
    enabled,
  });
}

/** Every matching row, up to Workiz's 10,000, for the CSV. */
export function exportActivity(filter: ActivityFilter): Promise<ActivityExport> {
  return http.get<ActivityExport>(`/deals/activity/export?${activityParams(filter)}`);
}
