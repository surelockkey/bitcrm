"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Inventory's and the Price Book's popups are component state: a row's
 * pencil, a "New" button, a stock button open one over the list and the
 * address never changes. One popup at a time — opening one replaces the one
 * that is open.
 *
 * Links still open them, without a query in the address:
 * - a link's own page (`/inventory/items/<id>`, `/inventory/warehouses/<id>`…)
 *   renders the list with its popup open — the `initial` here; closing it
 *   puts the list's own address back (`/inventory/items`), so a reload shows
 *   the list, not the popup again;
 * - an old link with the popup in its query (`?edit=<id>`, `?stock=<id>`…,
 *   how these pages worked before) opens it too — read once, then taken out
 *   of the address.
 */

/** How an old link named a popup in its query, and which params to take out after. */
export interface LegacyPopupQuery<P> {
  params: readonly string[];
  parse: (query: URLSearchParams) => P | null;
}

/**
 * The popup a link opened this page with: its own route's (`initial`), else an
 * old link's query. Computed once; the query is then taken out of the address
 * without a navigation (Next keeps its router in step with `replaceState`).
 */
export function useLinkedPopup<P>(initial?: P | null, legacy?: LegacyPopupQuery<P>): P | null {
  const [linked] = useState<P | null>(() => {
    if (initial) return initial;
    if (!legacy || typeof window === "undefined") return null;
    return legacy.parse(new URLSearchParams(window.location.search));
  });

  // Once: an old link's popup params leave the address.
  const params = legacy?.params.join(",");
  useEffect(() => {
    if (!params) return;
    const url = new URL(window.location.href);
    const names = params.split(",");
    if (!names.some((name) => url.searchParams.has(name))) return;
    for (const name of names) url.searchParams.delete(name);
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }, [params]);

  return linked;
}

/**
 * The page's popup. `linked` opens it from the first frame (see
 * `useLinkedPopup`); `listPath` is the list's own address, put back when a
 * popup a link's page opened is closed.
 */
export function usePopup<P>(linked: P | null, listPath: string) {
  const [popup, setPopup] = useState<P | null>(linked);

  // On a link's page (`/inventory/items/<id>`) its popup keeps that address;
  // once it closes or gives way to another, the address is the list's again.
  const toList = useCallback(() => {
    if (typeof window !== "undefined" && window.location.pathname !== listPath) {
      window.history.replaceState(window.history.state, "", listPath);
    }
  }, [listPath]);
  const open = useCallback(
    (next: P) => {
      setPopup(next);
      toList();
    },
    [toList],
  );
  const close = useCallback(() => {
    setPopup(null);
    toList();
  }, [toList]);

  return { popup, open, close };
}
