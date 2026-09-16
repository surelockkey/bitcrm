"use client";

import { useMemo } from "react";
import { useMe } from "@/features/auth/use-me";
import { useDeals } from "@/features/deals/hooks";
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
  // The server forces `techId = caller` under the assigned_only scope, but a
  // dispatcher opening this page still sees only THEIR jobs, so pass it — and
  // wait for the id rather than asking for the whole board in the meantime.
  const query = useDeals({ techId }, { poll: true, enabled: Boolean(techId) });
  const groups = useMemo(
    () => groupJobsByDay(query.data ?? [], todayIso, techId),
    [query.data, todayIso, techId],
  );
  return {
    ...query,
    groups,
    techId,
    /** False until `me` resolves — the list is "still loading", not "empty". */
    ready: Boolean(techId),
  };
}
