"use client";

import { useCallback, useState } from "react";
import { keepPreviousData, useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { dashboardPresetWindow } from "@bitcrm/types";
import { queryKeys } from "@/lib/query-keys";
import * as api from "./api";
import { localDay } from "./jobs-by-status";
import { DEFAULT_PRESET, type DayWindow } from "./ranges";

/**
 * The server builds these snapshots once a night, so the browser has no
 * reason to ask again every thirty seconds: an answer is kept fresh for five
 * minutes and in memory for half an hour. Coming back to the dashboard paints
 * from memory at once instead of fetching.
 */
const SNAPSHOT_STALE_MS = 5 * 60_000;
const SNAPSHOT_GC_MS = 30 * 60_000;

/**
 * A widget read from a server snapshot. `refetch` — the card's refresh button
 * — asks the server to rebuild it (`refresh=1`) and puts the answer in the
 * cache, so the button means "count again", not "fetch the same snapshot".
 *
 * Another range keeps the card's current answer on screen until its own is
 * in: a card that blanked to its skeleton shrank, and every card under it
 * moved up and back down.
 */
function useSnapshot<T>(queryKey: QueryKey, fetch: (opts?: api.SnapshotRequest) => Promise<T>) {
  const client = useQueryClient();
  const [rebuilding, setRebuilding] = useState(false);
  const query = useQuery({
    queryKey,
    queryFn: () => fetch(undefined),
    staleTime: SNAPSHOT_STALE_MS,
    gcTime: SNAPSHOT_GC_MS,
    placeholderData: keepPreviousData,
  });
  const key = JSON.stringify(queryKey);
  const refetch = useCallback(async () => {
    setRebuilding(true);
    try {
      client.setQueryData(JSON.parse(key) as QueryKey, await fetch({ refresh: true }));
    } finally {
      setRebuilding(false);
    }
    // `fetch` is a module-level function per widget; the key names the window.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, key]);
  return { ...query, isFetching: query.isFetching || rebuilding, refetch };
}

/** "Jobs By Status" over a window (the card works the window out from its range). */
export function useJobsByStatus(window: DayWindow) {
  return useSnapshot(queryKeys.dashboard.jobsByStatus(window), (opts) => api.getJobsByStatus(window, opts));
}

/** Any ranged snapshot widget: its name picks the cache entry, `fetch` the route. */
export function useRangeWidget<T>(
  name: string,
  fetch: (window: api.DayWindow, opts?: api.SnapshotRequest) => Promise<T>,
  window: DayWindow,
) {
  return useSnapshot(queryKeys.dashboard.widget(name, window), (opts) => fetch(window, opts));
}

/** A live widget: read as it is. */
function useLive<T>(queryKey: QueryKey, queryFn: () => Promise<T>, enabled = true) {
  return useQuery({ queryKey, queryFn, staleTime: 30_000, enabled, placeholderData: keepPreviousData });
}

/** "Today", on the account's calendar — live, not a snapshot. */
export function useToday(day: string) {
  return useLive(queryKeys.dashboard.widget("today", day), () => api.getToday(day));
}

export function useJobsNow() {
  return useLive(queryKeys.dashboard.widget("jobs-now"), api.getJobsNow);
}

export function useRecentCalls() {
  return useLive(queryKeys.dashboard.widget("recent-calls"), api.getRecentCalls);
}

/** "Invoices" over a window, or All time (`undefined`) — the key the bundle seeds is "all_time". */
export function useInvoicesWidget(window: DayWindow | undefined) {
  return useLive(queryKeys.dashboard.widget("invoices", window ?? "all_time"), () => api.getInvoicesWidget(window));
}

export function useEstimatesWidget() {
  return useLive(queryKeys.dashboard.widget("estimates"), api.getEstimatesWidget);
}

export function useComingUp(day: string) {
  return useLive(queryKeys.dashboard.widget("coming-up", day), () => api.getComingUp(day));
}

export function useRecentActivity(day: string) {
  return useLive(queryKeys.dashboard.widget("recent-activity", day), () => api.getRecentActivity(day));
}

/** Today's collected money — only asked for by a reader who may see it. */
export function useCollectedToday(day: string, enabled: boolean) {
  return useLive(queryKeys.dashboard.widget("collected", day), () => api.getCollectedToday(day), enabled);
}

/** What the page may open beyond the two stats services — each only when the reader may see it. */
export interface BundleExtras {
  invoices?: boolean;
  estimates?: boolean;
  comingUp?: boolean;
  recentActivity?: boolean;
  collected?: boolean;
}

/**
 * The dashboard's opening read: one request per stats service instead of one
 * per card, plus each of the other widgets the reader may see. Each answer is
 * laid into the cache entry of the card that shows it, under exactly the key
 * that card's own hook asks with, so the cards — drawn once it has settled —
 * find their data and paint together.
 *
 * Every part settles on its own: one failing leaves the others' cards
 * filled, and the failed ones simply fetch for themselves.
 */
export function useDashboardBundle(now: Date, extras: BundleExtras = {}) {
  const client = useQueryClient();
  const window = dashboardPresetWindow(DEFAULT_PRESET, now);
  const day = localDay(now);
  return useQuery({
    queryKey: queryKeys.dashboard.widget("bundle", { window, day, extras }),
    queryFn: async () => {
      const seed = (key: QueryKey, data: unknown) => {
        if (data !== undefined) client.setQueryData(key, data);
      };
      const optional = <T,>(on: boolean | undefined, load: () => Promise<T>) =>
        on ? load() : Promise.resolve(undefined);
      const [deal, calls, invoices, estimates, coming, activity, collected] = await Promise.allSettled([
        api.getDealBundle(window, day),
        api.getCallsBundle(window),
        optional(extras.invoices, () => api.getInvoicesWidget(undefined)),
        optional(extras.estimates, () => api.getEstimatesWidget()),
        optional(extras.comingUp, () => api.getComingUp(day)),
        optional(extras.recentActivity, () => api.getRecentActivityRows(day)),
        optional(extras.collected, () => api.getCollectedToday(day)),
      ]);
      // One directory lookup for every name the page needs — the two
      // scoreboards' people and the journal's actors — instead of one per
      // card. It lives under the users' names key, so anything asking for
      // the same people meanwhile shares the answer instead of asking again.
      const boards = deal.status === "fulfilled" ? [deal.value.techScoreboard, deal.value.dispatchScoreboard] : [];
      const rows = activity.status === "fulfilled" ? (activity.value ?? []) : [];
      const ids = [...new Set([...api.scoreboardIds(boards), ...api.activityActorIds(rows)])];
      const byId = ids.length
        ? await client
            .fetchQuery({ queryKey: queryKeys.users.names(ids), queryFn: () => api.namesById(ids), staleTime: SNAPSHOT_STALE_MS })
            .catch(() => ({}) as Record<string, string>)
        : {};
      if (deal.status === "fulfilled") {
        const d = deal.value;
        const [techScoreboard, dispatchScoreboard] = api.nameScoreboardsWith(boards, byId);
        seed(queryKeys.dashboard.widget("sales", window), d.sales);
        seed(queryKeys.dashboard.widget("top-sources", window), d.topSources);
        seed(queryKeys.dashboard.widget("top-job-types", window), d.topJobTypes);
        seed(queryKeys.dashboard.widget("service-areas", window), d.serviceAreas);
        seed(queryKeys.dashboard.widget("tech-scoreboard", window), techScoreboard);
        seed(queryKeys.dashboard.widget("dispatch-scoreboard", window), dispatchScoreboard);
        seed(queryKeys.dashboard.widget("today", day), d.today);
        seed(queryKeys.dashboard.widget("jobs-now"), d.jobsNow);
        seed(queryKeys.dashboard.jobsByStatus(window), d.jobsByStatus);
      }
      if (calls.status === "fulfilled") {
        seed(queryKeys.dashboard.widget("top-call-flows", window), calls.value.topCallFlows);
        seed(queryKeys.dashboard.widget("recent-calls"), calls.value.recentCalls);
      }
      if (invoices.status === "fulfilled") seed(queryKeys.dashboard.widget("invoices", "all_time"), invoices.value);
      if (estimates.status === "fulfilled") seed(queryKeys.dashboard.widget("estimates"), estimates.value);
      if (coming.status === "fulfilled") seed(queryKeys.dashboard.widget("coming-up", day), coming.value);
      if (activity.status === "fulfilled" && activity.value) {
        seed(queryKeys.dashboard.widget("recent-activity", day), api.nameActivityRows(activity.value, byId));
      }
      if (collected.status === "fulfilled") seed(queryKeys.dashboard.widget("collected", day), collected.value);
      return { at: Date.now() };
    },
    staleTime: SNAPSHOT_STALE_MS,
    gcTime: SNAPSHOT_GC_MS,
    retry: false,
  });
}
