"use client";

import { useState } from "react";

/**
 * Show a list's last whole state while the next one is on its way.
 *
 * A list is whole once its rows and everything printed beside them (the
 * company names, the source names, the count) are in. A new search, page or
 * page size makes the next set — and until IT is whole, the reader keeps the
 * set they had, numbers and all, marked `stale`, instead of an empty list, a
 * skeleton, or rows whose columns fill in a beat later. `shown` is undefined
 * only before the first whole set: that is the one time for a skeleton.
 *
 * `value` must keep its identity between renders while nothing in it changed
 * (memoise it): the hook remembers it by identity.
 */
export function useLastWhole<T>(value: T, whole: boolean): { shown: T | undefined; stale: boolean } {
  const [last, setLast] = useState<T | undefined>(undefined);
  // Set during render, not in an effect: the frame that has the new set is
  // the frame that shows it.
  if (whole && last !== value) setLast(value);
  if (whole) return { shown: value, stale: false };
  return { shown: last, stale: last !== undefined };
}
