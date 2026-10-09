"use client";

import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import { usePageReady } from "@/lib/use-page-ready";
import { PriceBookTabs } from "./price-book-tabs";

/** What a tab page and the frame over it say to each other. */
interface FrameContext {
  /** The page's first whole frame is up. */
  report: () => void;
}

const Frame = createContext<FrameContext | null>(null);

/**
 * The Price book's frame: Workiz's big tabs over the tab's page, the way the
 * Inventory frame draws its row. The tab names used to appear the moment the
 * permissions answered, over a grid still on its loader, and the rows a beat
 * later — two phases where the house rule allows one (app_audit 2026-10-09,
 * finding 18). The row now holds its placeholders until the page under it
 * reports its first whole frame, then draws the names in that very frame,
 * and keeps them drawn while the next tab loads.
 */
export function PriceBookFrame({ children, className }: { children: ReactNode; className?: string }) {
  const [shown, setShown] = useState(false);
  const report = useCallback(() => setShown(true), []);
  const value = useMemo(() => ({ report }), [report]);

  return (
    <Frame.Provider value={value}>
      <PriceBookTabs pending={!shown} className={className} />
      {children}
    </Frame.Provider>
  );
}

/**
 * `usePageReady` for a Price book tab: the tab's own gate, reported to the
 * frame before paint, so the tab row and the page appear in one frame. A
 * page outside the frame (a test, a popup) reports to nobody.
 */
export function usePriceBookPageReady(allIn: boolean, key?: string): boolean {
  const frame = useContext(Frame);
  const ready = usePageReady(allIn, key);
  const report = frame?.report;
  useLayoutEffect(() => {
    if (ready) report?.();
  }, [ready, report]);
  return ready;
}
