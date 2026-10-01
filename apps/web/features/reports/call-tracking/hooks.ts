"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { CallTrackingReport } from "@bitcrm/types";
import { http } from "@/lib/api/http";
import { queryKeys } from "@/lib/query-keys";
import { callTrackingQuery, type CallTrackingParams } from "./lib";

/** The report for one window, grouping and graph step — the server keeps a snapshot, so a switch is cheap. */
export function useCallTracking(params: CallTrackingParams, enabled = true) {
  return useQuery({
    queryKey: queryKeys.calls.tracking(params),
    queryFn: () => http.get<CallTrackingReport>(`/telephony/calls/stats/tracking?${callTrackingQuery(params)}`),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    enabled,
  });
}
