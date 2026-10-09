"use client";

import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import { usePageReady } from "@/lib/use-page-ready";
import { useInventoryTabCounts } from "@/features/inventory/tab-counts";
import { InventoryTabs } from "./inventory-tabs";

/** What a tab page and the frame over it say to each other. */
interface FrameContext {
  /** The tab row's counters have all answered. */
  countsSettled: boolean;
  /** The page's first whole frame is up. */
  report: () => void;
}

const Frame = createContext<FrameContext | null>(null);

/**
 * The Inventory screens' frame: Workiz's tab row with its counters over the
 * tab's page. The counters come with the page, not before it: each page's
 * one-load gate waits for them too, and the row holds its places until the
 * page under it reports its first whole frame — then draws the tabs and their
 * counters together, and keeps them drawn while the next tab loads.
 */
export function InventoryFrame({ children }: { children: ReactNode }) {
  const [shown, setShown] = useState(false);
  const report = useCallback(() => setShown(true), []);
  const { counts, settled } = useInventoryTabCounts();
  const value = useMemo(() => ({ countsSettled: settled, report }), [settled, report]);

  return (
    <Frame.Provider value={value}>
      {/* Workiz's tabs stand 18px under the 36px breadcrumb (its row y106 + 4, the rule at 149). */}
      <InventoryTabs counts={counts} pending={!shown} className="mt-[18px]" />
      {children}
    </Frame.Provider>
  );
}

/**
 * A tab page says its first whole frame is up — before paint, so the tab
 * row's counters land in that very frame. A page outside the frame (a test,
 * a popup) reports to nobody.
 */
export function useReportInventoryReady(ready: boolean) {
  const frame = useContext(Frame);
  const report = frame?.report;
  useLayoutEffect(() => {
    if (ready) report?.();
  }, [ready, report]);
}

/**
 * `usePageReady` for an Inventory tab: everything the tab shows (`allIn`)
 * plus the tab row's counters, then reported to the frame, so the row and
 * the page appear in one frame. A page on its own has no row to wait for.
 */
export function useInventoryPageReady(allIn: boolean, key?: string): boolean {
  const frame = useContext(Frame);
  const ready = usePageReady(allIn && (frame?.countsSettled ?? true), key);
  useReportInventoryReady(ready);
  return ready;
}
