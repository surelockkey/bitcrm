"use client";

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import * as api from "./api";
import type { CallsFilter } from "./lib";

/** Safety-net poll — SSE is the primary transport for live updates. */
const LIVE_FALLBACK_POLL_MS = 30_000;

export function useCallsList(filter: CallsFilter) {
  return useInfiniteQuery({
    queryKey: queryKeys.calls.list(filter),
    queryFn: ({ pageParam }) => api.listCalls(filter, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.pagination.nextCursor,
  });
}

/**
 * Every call involving any of a client's numbers, newest first. Idle until
 * the client's phone list is known — a query with no numbers would return the
 * whole global log, which is emphatically not "this client's calls".
 */
export function useCallsForNumbers(numbers: string[]) {
  return useInfiniteQuery({
    queryKey: queryKeys.calls.list({ numbers }),
    queryFn: ({ pageParam }) => api.listCalls({ numbers }, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.pagination.nextCursor,
    enabled: numbers.length > 0,
  });
}

export function useLiveCalls() {
  return useQuery({
    queryKey: queryKeys.calls.live(),
    queryFn: api.getLiveCalls,
    refetchInterval: LIVE_FALLBACK_POLL_MS,
  });
}

export function useCallDetail(sid: string) {
  return useQuery({
    queryKey: queryKeys.calls.detail(sid),
    queryFn: () => api.getCall(sid),
  });
}
