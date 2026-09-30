"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Inventory's and the Price Book's popups are component state: a row's
 * pencil, a "New" button, a stock button open one over the list and the
 * address never changes. One popup at a time — opening one replaces the one
 * that is open. Every visit starts with none open.
 *
 * No address opens a popup. Before this, the popups lived in the query
 * (`?edit=<id>`, `?stock=<id>`, `?new=1`…); an old link or bookmark like that
 * lands on the plain list, and `staleParams` are taken out of the address
 * (without a navigation — Next keeps its router in step with `replaceState`).
 */
export function usePopup<P>(staleParams: readonly string[] = []) {
  const [popup, setPopup] = useState<P | null>(null);
  useDropStaleParams(staleParams);

  const open = useCallback((next: P) => setPopup(next), []);
  const close = useCallback(() => setPopup(null), []);

  return { popup, open, close };
}

/** Once: old popup params leave the address — nothing is opened from them. */
export function useDropStaleParams(staleParams: readonly string[]) {
  const names = staleParams.join(",");
  useEffect(() => {
    if (!names) return;
    const url = new URL(window.location.href);
    const params = names.split(",");
    if (!params.some((name) => url.searchParams.has(name))) return;
    for (const name of params) url.searchParams.delete(name);
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }, [names]);
}
