"use client";

import { useEffect, useRef, useState, type RefObject } from "react";

/** How far the finger must travel, from the top of the list, to refresh. */
export const PULL_THRESHOLD_PX = 72;
/** The indicator never grows past this, however far the finger goes. */
const PULL_MAX_PX = 120;

export interface PullToRefreshState {
  /** Current pull distance in px (0 when idle); drives the indicator. */
  pull: number;
  /** True from the release that crossed the threshold until `onRefresh` settles. */
  refreshing: boolean;
}

/**
 * Pull-to-refresh on a scroll container, the way a native list does it: a
 * downward drag that starts while the list is scrolled to the very top
 * grows an indicator; letting go past the threshold runs `onRefresh`.
 *
 * Touch-only by design — a mouse has a Refresh button. The gesture is
 * ignored unless it starts at `scrollTop === 0`, so ordinary scrolling
 * inside the list never fights it, and `touch-action` is left alone so
 * horizontal swipes and pinch-zoom keep working.
 */
export function usePullToRefresh(
  ref: RefObject<HTMLElement | null>,
  onRefresh: () => Promise<unknown> | unknown,
): PullToRefreshState {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef<number | null>(null);
  const pullRef = useRef(0);
  // Kept in a ref so the listeners below are attached once, not on every
  // render the callback's identity changes — written after commit, never
  // during render.
  const refreshRef = useRef(onRefresh);
  useEffect(() => {
    refreshRef.current = onRefresh;
  }, [onRefresh]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const setPullBoth = (px: number) => {
      pullRef.current = px;
      setPull(px);
    };

    const onStart = (e: TouchEvent) => {
      if (el.scrollTop > 0 || refreshing) {
        startY.current = null;
        return;
      }
      startY.current = e.touches[0]?.clientY ?? null;
    };

    const onMove = (e: TouchEvent) => {
      if (startY.current === null) return;
      const y = e.touches[0]?.clientY;
      if (y === undefined) return;
      const delta = y - startY.current;
      if (delta <= 0 || el.scrollTop > 0) {
        setPullBoth(0);
        return;
      }
      // Rubber-band: the indicator moves half as far as the finger.
      setPullBoth(Math.min(PULL_MAX_PX, delta / 2));
    };

    const onEnd = () => {
      if (startY.current === null) return;
      startY.current = null;
      const reached = pullRef.current >= PULL_THRESHOLD_PX;
      setPullBoth(0);
      if (!reached) return;
      setRefreshing(true);
      Promise.resolve()
        .then(() => refreshRef.current())
        .catch(() => {})
        .finally(() => setRefreshing(false));
    };

    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: true });
    el.addEventListener("touchend", onEnd);
    el.addEventListener("touchcancel", onEnd);
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, [ref, refreshing]);

  return { pull, refreshing };
}
