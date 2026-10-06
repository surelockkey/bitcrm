"use client";

import { useState } from "react";

/** The parts of a query this asks about — a `useQuery` result has them all. */
export interface QueryState {
  data: unknown;
  isError: boolean;
  isPending: boolean;
  fetchStatus: "fetching" | "paused" | "idle";
}

/**
 * A query is in once it answered, failed, or was never going to be asked
 * (disabled: pending, and not fetching). A failure counts as in, so one broken
 * request never keeps a page behind its skeleton.
 */
export function settled(q: QueryState): boolean {
  return q.data !== undefined || q.isError || (q.isPending && q.fetchStatus === "idle");
}

/**
 * Hold a page behind one skeleton until everything it shows is in, then
 * show it whole — and keep it shown.
 *
 * A page that draws each block the moment its own data lands fills in while
 * the reader watches; `allIn` is the caller's "everything this screen shows
 * has answered" (usually `queries.every(settled)` and the like). Once true the
 * answer latches: a refetch after a save, or a key that changed under it,
 * must not take the page — and the draft behind it — away again.
 *
 * `key` starts it over: a list whose filters changed is a new first paint
 * (pass the list's query key), while a page that should never go back to its
 * skeleton passes nothing.
 */
export function usePageReady(allIn: boolean, key?: string): boolean {
  const [readyFor, setReadyFor] = useState<string | null>(null);
  const k = key ?? "";
  // Set during render, not in an effect: the frame that has everything is the
  // frame that shows it, with no extra empty render in between.
  if (allIn && readyFor !== k) setReadyFor(k);
  return allIn || readyFor === k;
}
