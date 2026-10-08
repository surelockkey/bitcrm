"use client";

import { Fragment, useEffect, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { usePageHistoryStore } from "@/stores/page-history-store";

const subscribeNever = () => () => {};

/** False on the server-rendered frame, true after hydration. */
function useHydrated() {
  return useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
}

/**
 * Trail of the last visited pages ("SETTINGS # USERS # JOBS"), rendered under
 * the header on every authenticated page. Also the single place that records
 * navigations into the history store.
 *
 * Drawn as Workiz's `SAJhistory` strip (audit_pixels L12, uikit_wz_*): 11px
 * regular capitals tracked 0.4px, every crumb ink #3b4b52 — the current one
 * no bolder — "#" between them in the same ink, 20px in, and no rule under
 * the strip.
 */
export function PageHistoryBar() {
  const pathname = usePathname();
  const visit = usePageHistoryStore((s) => s.visit);
  const visits = usePageHistoryStore((s) => s.visits);

  // The store is persisted to localStorage, so the trail must not render on
  // the server-rendered frame or hydration would mismatch.
  const hydrated = useHydrated();

  useEffect(() => {
    if (pathname) visit(pathname);
  }, [pathname, visit]);

  if (!hydrated || visits.length === 0) return null;

  return (
    <nav
      aria-label="Recently visited"
      className="flex h-9 shrink-0 items-center gap-[5px] overflow-x-auto px-5 text-[11px] leading-4 font-normal tracking-[0.4px] text-foreground uppercase"
    >
      {visits.map((v, i) => {
        const current = i === visits.length - 1;
        return (
          <Fragment key={v.path}>
            {i > 0 ? (
              <span aria-hidden className="text-foreground">
                #
              </span>
            ) : null}
            <Link
              href={v.path}
              aria-current={current ? "page" : undefined}
              className={cn(
                "whitespace-nowrap hover:underline",
                current ? "text-wz-strong" : "text-foreground",
              )}
            >
              {v.label}
            </Link>
          </Fragment>
        );
      })}
    </nav>
  );
}

/**
 * Lets a detail page upgrade its generic trail label once its data is known,
 * e.g. "Job" → "Job (3QI2BN)". Pass undefined while loading.
 */
export function usePageHistoryLabel(label: string | undefined) {
  const pathname = usePathname();
  const setLabel = usePageHistoryStore((s) => s.setLabel);

  useEffect(() => {
    if (label && pathname) setLabel(pathname, label);
  }, [label, pathname, setLabel]);
}
