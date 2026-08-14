"use client";

import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import { getApiErrorMessage } from "@/lib/api/errors";
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
 * Every call with one client, company or teammate, newest first — served by
 * the party index, so cost tracks their call count rather than the size of
 * the whole log.
 */
export function useCallsForParty(
  kind: "contact" | "company" | "user",
  id: string | undefined,
) {
  return useInfiniteQuery({
    queryKey: queryKeys.calls.byParty(kind, id ?? ""),
    queryFn: ({ pageParam }) =>
      api.listCallsByParty(kind, id as string, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.pagination.nextCursor,
    enabled: !!id,
  });
}

/**
 * Attach a call to a job (or detach). Refreshes the call views and the job's
 * activity feed, which is where the link shows up on the other side.
 */
export function useLinkCallToDeal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ sid, dealId }: { sid: string; dealId: string | null }) =>
      api.setCallDeal(sid, dealId),
    onSuccess: (_call, { dealId }) => {
      qc.invalidateQueries({ queryKey: queryKeys.calls.all() });
      if (dealId) qc.invalidateQueries({ queryKey: queryKeys.deals.all() });
      toast.success(dealId ? "Linked to job" : "Unlinked from job");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

/** Correct who a call was with. */
export function useSetCallParty() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: {
      sid: string;
      side: "from" | "to";
      kind: "user" | "contact" | "company" | null;
      id: string;
    }) => api.setCallParty(args.sid, args),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.calls.all() });
      toast.success("Client updated on this call");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export function useLiveCalls() {
  return useQuery({
    queryKey: queryKeys.calls.live(),
    queryFn: api.getLiveCalls,
    refetchInterval: LIVE_FALLBACK_POLL_MS,
  });
}

/**
 * The call this user is on, polled while the softphone says a call is up.
 * Everything that acts on "the current call" — link to job, create job,
 * transfer — needs the record, not just the number in the browser.
 */
export function useActiveCall(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.calls.active(),
    queryFn: api.getActiveCall,
    enabled,
    refetchInterval: enabled ? 5_000 : false,
    staleTime: 2_000,
  });
}

export function useCallDetail(sid: string) {
  return useQuery({
    queryKey: queryKeys.calls.detail(sid),
    queryFn: () => api.getCall(sid),
    // Callers pass "" when there is no call in hand yet.
    enabled: !!sid,
  });
}
