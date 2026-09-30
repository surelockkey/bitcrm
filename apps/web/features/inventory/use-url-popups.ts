"use client";

import { useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";

/**
 * Inventory's popups live in the URL (`?edit=<id>`, `?stock=<id>`, `?new=1`),
 * so a link — or an old detail-page address, redirected — opens one. One at
 * a time: setting a popup clears the others. A popup that needs more than one
 * value carries `extras` (`?apply=<templateId>&container=<id>`); they are
 * cleared with the popups.
 *
 * Opening pushes, so Back closes the popup. Closing one we pushed steps back
 * over that entry: replacing it would leave the list twice in a row, and the
 * next Back would land on the same page and seem to do nothing. A popup that
 * arrived in the URL has no list entry under it, so that one is replaced.
 * The page needs a Suspense boundary for `useSearchParams`.
 */
export function useUrlPopups<P extends string, E extends string = never>(
  path: string,
  popups: readonly P[],
  extras: readonly E[] = [],
) {
  const router = useRouter();
  const searchParams = useSearchParams();
  // The address of the entry this page pushed, while it's still that entry.
  const pushed = useRef<string | null>(null);

  const href = (params: URLSearchParams) => {
    const qs = params.toString();
    return qs ? `${path}?${qs}` : path;
  };
  const urlWith = (popup?: P, value?: string, extra?: Partial<Record<E, string>>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const p of [...popups, ...extras]) params.delete(p);
    if (popup) params.set(popup, value ?? "1");
    for (const [k, v] of Object.entries(extra ?? {}) as [E, string | undefined][]) {
      if (v) params.set(k, v);
    }
    return href(params);
  };
  const onPushedEntry = () => pushed.current === href(searchParams);

  return {
    param: (name: P | E) => searchParams.get(name),
    open: (popup: P, value?: string, extra?: Partial<Record<E, string>>) => {
      pushed.current = urlWith(popup, value, extra);
      router.push(pushed.current, { scroll: false });
    },
    /** Swap one popup for another (or change its extras) without a new history entry. */
    replace: (popup: P, value?: string, extra?: Partial<Record<E, string>>) => {
      const next = urlWith(popup, value, extra);
      if (onPushedEntry()) pushed.current = next;
      router.replace(next, { scroll: false });
    },
    close: () => {
      if (onPushedEntry()) {
        pushed.current = null;
        router.back();
      } else {
        router.replace(urlWith(), { scroll: false });
      }
    },
  };
}
