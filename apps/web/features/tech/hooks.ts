"use client";

import { useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { Deal } from "@bitcrm/types";
import { queryKeys } from "@/lib/query-keys";
import { getApiErrorMessage } from "@/lib/api/errors";
import { useMe } from "@/features/auth/use-me";
import { useDealsWindow } from "@/features/deals/hooks";
import * as dealsApi from "@/features/deals/api";
import * as messagingApi from "@/features/messaging/api";
import { newClientMessageId } from "@/features/messaging/lib";
import { groupJobsByDay, localDateIso } from "./lib";

/**
 * The signed-in technician's jobs, grouped into the day list they work
 * from. Polls like the dispatch board so a job assigned while the phone is
 * in a pocket shows up without a reload; the list also refetches on the
 * pull-to-refresh gesture (`refetch`).
 */
export function useMyJobs(todayIso: string = localDateIso()) {
  const { data: me } = useMe();
  const techId = me?.id;
  // `techId` is what makes this page "mine": the server only DEFAULTS it to
  // the caller under the assigned_only scope (`DealsService.list`), and a
  // dispatcher opening this page has no scope narrowing them at all, so the
  // id has to be sent — and waited for, rather than asking for the whole
  // board in the meantime.
  // Two bounded reads instead of the technician's whole history: everything
  // still open (overdue, undated, today, later), plus today's closed work,
  // which the day list keeps as "done this morning".
  const enabled = Boolean(techId);
  const open = useDealsWindow({ techId }, { poll: true, enabled });
  const today = useDealsWindow({ techId, from: todayIso, to: todayIso }, { poll: true, enabled });
  const deals = useMemo(() => {
    const seen = new Set<string>();
    const out: Deal[] = [];
    for (const d of [...(open.data ?? []), ...(today.data ?? [])]) {
      if (seen.has(d.id)) continue;
      seen.add(d.id);
      out.push(d);
    }
    return out;
  }, [open.data, today.data]);
  const groups = useMemo(() => groupJobsByDay(deals, todayIso, techId), [deals, todayIso, techId]);
  return {
    data: deals,
    isLoading: open.isLoading || today.isLoading,
    isError: open.isError || today.isError,
    isFetching: open.isFetching || today.isFetching,
    isRefetching: open.isRefetching || today.isRefetching,
    error: open.error ?? today.error,
    refetch: async () => {
      await Promise.all([open.refetch(), today.refetch()]);
    },
    groups,
    techId,
    /** False until `me` resolves — the list is "still loading", not "empty". */
    ready: Boolean(techId),
  };
}

/* -------------------------------------------------------------- actions */

/**
 * Every technician action lands on the same job, so they all refresh the same
 * three things: the job itself, the day list it came from, and its activity
 * feed (each action writes a timeline entry dispatch reads).
 */
function useRefreshJob(dealId: string) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: queryKeys.deals.all() });
    qc.invalidateQueries({ queryKey: queryKeys.deals.detail(dealId) });
    qc.invalidateQueries({ queryKey: queryKeys.deals.timeline(dealId) });
  };
}

/** Paint the new stamp on the cached job at once — the phone may be on one bar. */
function stampDeal(qc: ReturnType<typeof useQueryClient>, dealId: string, patch: Partial<Deal>) {
  const key = queryKeys.deals.detail(dealId);
  const previous = qc.getQueryData<Deal>(key);
  if (previous) qc.setQueryData<Deal>(key, { ...previous, ...patch });
  return previous;
}

/** "Confirm receipt" — Workiz's *Confirmed job receipt*. */
export function useConfirmReceipt(dealId: string) {
  const qc = useQueryClient();
  const refresh = useRefreshJob(dealId);
  const { data: me } = useMe();
  return useMutation({
    mutationFn: () => dealsApi.confirmJobReceipt(dealId),
    onMutate: () => ({
      previous: stampDeal(qc, dealId, {
        techConfirmedAt: new Date().toISOString(),
        techConfirmedBy: me?.id,
      }),
    }),
    onError: (e, _v, ctx) => {
      if (ctx?.previous) qc.setQueryData(queryKeys.deals.detail(dealId), ctx.previous);
      toast.error(getApiErrorMessage(e));
    },
    onSuccess: () => toast.success("Job confirmed"),
    onSettled: refresh,
  });
}

/** "Arrived" — Workiz's *Arrived at location*, with the phone's fix when it offered one. */
export function useMarkArrived(dealId: string) {
  const qc = useQueryClient();
  const refresh = useRefreshJob(dealId);
  const { data: me } = useMe();
  return useMutation({
    mutationFn: (body: dealsApi.MarkArrivedBody = {}) => dealsApi.markArrived(dealId, body),
    onMutate: () => ({
      previous: stampDeal(qc, dealId, {
        arrivedAt: new Date().toISOString(),
        arrivedBy: me?.id,
      }),
    }),
    onError: (e, _v, ctx) => {
      if (ctx?.previous) qc.setQueryData(queryKeys.deals.detail(dealId), ctx.previous);
      toast.error(getApiErrorMessage(e));
    },
    onSuccess: () => toast.success("Arrival recorded"),
    onSettled: refresh,
  });
}

/**
 * The phone's own position, if it will give one — and a quick answer either
 * way. "Arrived" must never hang on a GPS fix that isn't coming: the timeout
 * resolves to `undefined` and the arrival is recorded without coordinates.
 */
export const GEOLOCATION_TIMEOUT_MS = 8_000;

/**
 * The widest fix the server will store (`MarkArrivedDto.accuracy`, `@Max`).
 * A laptop or a tablet with no GPS gets its position from the network and can
 * report a radius of hundreds of kilometres; that number is an annotation, so
 * it is dropped rather than allowed to 400 the arrival it annotates.
 */
export const MAX_REPORTED_ACCURACY_M = 100_000;

const reportableAccuracy = (accuracy: number): boolean =>
  Number.isFinite(accuracy) && accuracy >= 0 && accuracy <= MAX_REPORTED_ACCURACY_M;

export function currentPosition(): Promise<
  { lat: number; lng: number; accuracy?: number } | undefined
> {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return Promise.resolve(undefined);
  }
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (p) =>
        resolve({
          lat: p.coords.latitude,
          lng: p.coords.longitude,
          ...(reportableAccuracy(p.coords.accuracy) ? { accuracy: p.coords.accuracy } : {}),
        }),
      () => resolve(undefined),
      { enableHighAccuracy: true, timeout: GEOLOCATION_TIMEOUT_MS, maximumAge: 60_000 },
    );
  });
}

/**
 * "On my way" / "Running late" — the workspace's own text, rendered and sent
 * server-side.
 *
 * Each tap mints its own `clientMessageId`. Without one the server dedupes on
 * (rule, job, technician, 15-minute bucket), which ignores the minutes: a
 * technician who says "15 minutes" and then, five minutes later, "45 minutes"
 * would see the second text accepted (202) and silently dropped as a duplicate,
 * while the client was never told. A genuine double-tap is already covered —
 * the button is disabled while the mutation is in flight.
 */

/** "On my way" — the workspace's own text, rendered and sent server-side. */
export function useOnMyWay(dealId: string) {
  return useMutation({
    mutationFn: (etaMinutes?: number) =>
      messagingApi.sendOnMyWay({
        dealId,
        ...(etaMinutes ? { etaMinutes } : {}),
        clientMessageId: newClientMessageId(),
      }),
    onSuccess: () => toast.success("Client told you're on the way"),
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

/** "Running late" — same, with how many minutes. */
export function useRunningLate(dealId: string) {
  return useMutation({
    mutationFn: (minutes: number) =>
      messagingApi.sendRunningLate({ dealId, minutes, clientMessageId: newClientMessageId() }),
    onSuccess: () => toast.success("Client told you're running late"),
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}
