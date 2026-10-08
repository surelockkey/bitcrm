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
import { getDeal, getDealsByIds } from "@/features/deals/api";
import * as api from "./api";
import { linkedDealIds, type CallRecord, type CallsFilter } from "./lib";

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

/**
 * Скільки всього рядків під тими самими фільтрами — з цього панель робить
 * «Page 2 of 7». Сервер тримає число тридцять секунд, тож і тут стільки ж.
 */
export function useCallsCount(filter: CallsFilter) {
  return useQuery({
    queryKey: queryKeys.calls.count(filter),
    queryFn: () => api.countCalls(filter),
    staleTime: 30_000,
  });
}

/**
 * The stat cards over the log, for the same filters as the rows. The
 * endpoint is new (see `getCallsSummary`): a server without it answers 404,
 * which is an answer — the page draws CALLS from the count and moves on —
 * so it is neither retried nor allowed to hold the page up.
 */
export function useCallsSummary(filter: CallsFilter, enabled = true) {
  return useQuery({
    queryKey: queryKeys.calls.summary(filter),
    queryFn: () => api.getCallsSummary(filter),
    enabled,
    staleTime: 30_000,
    retry: false,
  });
}

/**
 * Bring the jobs a page of calls is linked to into the cache, under the key
 * the table reads them by (`useDealsByIds(linkedDealIds(rows))`).
 *
 * Never throws: a page whose jobs could not be read still shows its calls,
 * with a dash where the job would be.
 */
function prefetchLinkedDeals(qc: QueryClient, calls: CallRecord[]): Promise<void> {
  const ids = linkedDealIds(calls);
  if (!ids.length) return Promise.resolve();
  return qc.prefetchQuery({
    queryKey: queryKeys.deals.byIds(ids),
    queryFn: () => getDealsByIds(ids),
    // `useDealsByIds`'s own: the table mounting on these rows reads them, it
    // does not ask again.
    staleTime: 30_000,
  });
}

export function useCallsList(filter: CallsFilter, limit = 25) {
  const qc = useQueryClient();
  return useInfiniteQuery({
    // Розмір сторінки — частина ключа: інакше вибір «по 100» читав би кеш,
    // складений по 25.
    queryKey: queryKeys.calls.list({ ...filter, limit }),
    // A page arrives with the jobs its rows are linked to. Asked for by the
    // table once the rows were drawn, they landed a beat later — the Job
    // column pulsed, and the job-tag chips that came after were taller than
    // the dash they replaced, so every row below slid down. Here the page
    // (the first, the next one, a refetch after a call ends) is only handed
    // over once its jobs are in.
    queryFn: async ({ pageParam }) => {
      const page = await api.listCalls(filter, pageParam, limit);
      await prefetchLinkedDeals(qc, page.data);
      return page;
    },
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

/** `enabled`: a page that shows the strip only for a call still going asks only then. */
export function useLiveCalls(enabled = true) {
  return useQuery({
    queryKey: queryKeys.calls.live(),
    queryFn: api.getLiveCalls,
    enabled,
    refetchInterval: LIVE_FALLBACK_POLL_MS,
    // Fresh for as long as the poll's own beat: the call log asks for this
    // before it draws the strip, and the strip mounting a moment later must
    // read that answer rather than ask again. The stream patches it between.
    staleTime: LIVE_FALLBACK_POLL_MS,
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

/**
 * One call, with the row it was opened from as a seed.
 *
 * The log already carries the whole record — the list endpoint resolves the
 * party names itself — and the detail endpoint answers the same question for
 * one call. Waiting on it while holding the answer is what made the side
 * panel feel slow, so the row is drawn at once and the request only refreshes
 * it. `placeholderData`, not `initialData`: the seed is a good answer, not a
 * cached one, so it never stands in for a real fetch.
 */
export function useCallDetail(sid: string, seed?: CallRecord) {
  return useQuery({
    queryKey: queryKeys.calls.detail(sid),
    queryFn: () => api.getCall(sid),
    // Callers pass "" when there is no call in hand yet.
    enabled: !!sid,
    placeholderData: seed,
  });
}

/**
 * The job a call is linked to — `useDeal`'s own query (same key, same
 * request), held fresh for half a minute.
 *
 * The call page asks for it before it draws, and the Associations block
 * reading it once drawn must find that answer rather than ask again — which a
 * query that goes stale at once does the moment the block mounts.
 */
export function useCallJob(dealId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.deals.detail(dealId ?? ""),
    queryFn: () => getDeal(dealId as string),
    enabled: !!dealId,
    staleTime: 30_000,
  });
}
