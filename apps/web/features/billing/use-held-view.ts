"use client";

import { useState } from "react";

/**
 * What a list last showed whole, held while its next set is on its way.
 *
 * A billing list is more than its rows: the cards above it and the pager
 * under it are numbers of their own, and the client printed beside each row
 * comes from a second request that cannot start until the rows say whose
 * names to ask for. Drawn as each piece lands, another date window, status or
 * page fills in while the reader watches — "—" in the cards, a grey block,
 * the rows, then their names. Instead the reader keeps the set they were
 * looking at until the next one is complete, and it replaces it in one frame.
 *
 * `view` is what the caller draws; `parts` are the pieces it is made of,
 * compared by identity (query data, memoised maps, a page number) — a change
 * in any of them while `complete` is a new view to hold. Like an effect's
 * dependencies they must keep their identity from one render to the next: a
 * part rebuilt on every render is a new view on every render. Until the first
 * complete view there is nothing to hold: `shown` is false and the caller
 * keeps its skeleton. `held` says the view on screen is the previous one, so
 * the caller can mark it as on its way out.
 */
export function useHeldView<T>(
  view: T,
  parts: readonly unknown[],
  complete: boolean,
): { view: T; shown: boolean; held: boolean } {
  const [kept, setKept] = useState<{ view: T; parts: readonly unknown[] } | null>(null);
  const changed =
    kept === null || kept.parts.length !== parts.length || parts.some((p, i) => !Object.is(p, kept.parts[i]));
  // Set during render, as `usePageReady` does: the frame that completes the
  // view is the frame that keeps it.
  if (complete && changed) setKept({ view, parts });

  if (complete) return { view, shown: true, held: false };
  if (kept) return { view: kept.view, shown: true, held: true };
  return { view, shown: false, held: false };
}

/**
 * The pager of a held view, drawn but not walked: its cursors belong to a set
 * that is no longer asked for, so it keeps showing where the reader was and
 * offers no page until the next set is in (the panel disables the page
 * numbers on `isFetching`).
 */
export function heldPager<P extends { canPrev: boolean; canNext: boolean; isFetching: boolean }>(pager: P): P {
  return { ...pager, canPrev: false, canNext: false, isFetching: true };
}
