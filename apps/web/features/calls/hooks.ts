"use client";

import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import type { PaginatedResponse } from "@bitcrm/types";
import { getApiErrorMessage } from "@/lib/api/errors";
import { queryKeys } from "@/lib/query-keys";
import * as api from "./api";
import type { CallRecord, CallsFilter } from "./lib";

type CallPages = InfiniteData<PaginatedResponse<CallRecord>, string | undefined>;

/**
 * Write the tag list the server just stored into the caches that already hold
 * this call, before the invalidated queries have refetched.
 *
 * Without this there is a gap — mutation settled, refetch still in flight — in
 * which a cell that dropped its optimistic draft would draw the pre-edit list
 * again. The refetch still runs; this only removes the blink. Only `tagIds` is
 * copied, and always by key, so "the last tag came off" (absent, never `[]`)
 * lands as absent rather than being skipped as "nothing to merge".
 */
function patchCachedCallTags(qc: QueryClient, call: CallRecord) {
  const retag = (c: CallRecord): CallRecord =>
    c.callSid === call.callSid ? { ...c, tagIds: call.tagIds } : c;

  qc.setQueryData<CallRecord>(queryKeys.calls.detail(call.callSid), (prev) =>
    prev ? retag(prev) : call,
  );
  qc.setQueriesData<CallPages>(
    { queryKey: queryKeys.calls.lists() },
    (prev) =>
      prev && {
        ...prev,
        pages: prev.pages.map((page) => ({ ...page, data: page.data.map(retag) })),
      },
  );
}

/** Safety-net poll — SSE is the primary transport for live updates. */
/**
 * How often the live list refetches on its own.
 *
 * SSE is what makes it feel instant, and this is what makes it correct when
 * SSE isn't delivering — a dropped stream, a proxy that buffers, a laptop
 * waking up. Thirty seconds was too coarse for a page whose whole subject is
 * calls happening right now: a short call could begin and end without ever
 * being drawn. Five is a request every few seconds against one small query.
 */
const LIVE_FALLBACK_POLL_MS = 5_000;

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

/**
 * Tag a call, or take a tag off it.
 *
 * The API takes a delta, so what the caller passes is the ids that changed —
 * not the list. Refreshes every call view, because the same record is drawn in
 * the log, the side preview and the call page at once.
 */
export function useSetCallTags() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { sid: string; add?: string[]; remove?: string[] }) =>
      api.setCallTags(args.sid, { add: args.add, remove: args.remove }),
    onSuccess: (call) => {
      // The list the server actually stored goes into the cache first, so the
      // cell can drop its optimistic draft the moment the write settles
      // without the chips blinking back to the pre-edit list.
      patchCachedCallTags(qc, call);
      qc.invalidateQueries({ queryKey: queryKeys.calls.all() });
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
    // A tab that was hidden while a call started should show it on return,
    // rather than waiting out the next interval.
    refetchOnWindowFocus: true,
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
