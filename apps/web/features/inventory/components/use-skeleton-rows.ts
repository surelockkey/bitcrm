"use client";

import { useEffect, useState } from "react";

const key = (list: string) => `bitcrm.skeleton-rows.${list}`;

function remembered(list: string): number | null {
  try {
    const n = Number(localStorage.getItem(key(list)));
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch {
    // A private window or blocked site data: no memory, a page's worth instead.
    return null;
  }
}

/**
 * How many skeleton rows a list draws before its first page lands.
 *
 * A page's worth suits the items catalogue and not three warehouses: fifty
 * placeholder rows collapsing to three is the jump a skeleton is meant to
 * prevent. So it is the count when the server has already answered it, else
 * the rows this list showed on the last visit, else a page — never more than
 * a page, and at least one row.
 *
 * `shown` is the number of rows on screen once real ones are there; it is
 * what the next visit starts from.
 */
export function useSkeletonRows(
  list: string,
  pageSize: number,
  total: number | null | undefined,
  shown: number | undefined,
): number {
  const [last] = useState(() => remembered(list));

  useEffect(() => {
    if (shown === undefined) return;
    try {
      localStorage.setItem(key(list), String(shown));
    } catch {
      // Same as reading: this visit sizes itself, the next one starts from a page.
    }
  }, [list, shown]);

  const guess = typeof total === "number" ? total : (last ?? pageSize);
  return Math.max(1, Math.min(pageSize, guess));
}
