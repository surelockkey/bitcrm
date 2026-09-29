"use client";

import { useRouter, useSearchParams } from "next/navigation";

/**
 * Inventory's popups live in the URL (`?edit=<id>`, `?stock=<id>`, `?new=1`),
 * so a link — or an old detail-page address, redirected — opens one. One at
 * a time: setting a popup clears the others.
 *
 * Opening pushes, so Back closes the popup; closing replaces, so Back doesn't
 * reopen it. The page needs a Suspense boundary for `useSearchParams`.
 */
export function useUrlPopups<P extends string>(path: string, popups: readonly P[]) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const urlWith = (popup?: P, value?: string) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const p of popups) params.delete(p);
    if (popup) params.set(popup, value ?? "1");
    const qs = params.toString();
    return qs ? `${path}?${qs}` : path;
  };

  return {
    param: (popup: P) => searchParams.get(popup),
    open: (popup: P, value?: string) => router.push(urlWith(popup, value), { scroll: false }),
    /** Swap one popup for another without a new history entry. */
    replace: (popup: P, value?: string) => router.replace(urlWith(popup, value), { scroll: false }),
    close: () => router.replace(urlWith(), { scroll: false }),
  };
}
