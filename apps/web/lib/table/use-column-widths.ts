"use client";

import { useCallback, useState } from "react";

/**
 * Narrow enough to read a date in, wide enough that the drag handle is still
 * there to grab on the way back. A column dragged to nothing cannot be
 * recovered with the mouse, which is the one mistake this has to prevent.
 */
export const COLUMN_MIN_WIDTH = 56;

/**
 * A column wider than this hides every other one behind a horizontal scroll,
 * which reads as the table having broken rather than the reader having
 * dragged too far.
 */
export const COLUMN_MAX_WIDTH = 900;

const key = (table: string) => `bitcrm.column-widths.${table}`;

const clamp = (px: number): number =>
  Math.min(COLUMN_MAX_WIDTH, Math.max(COLUMN_MIN_WIDTH, Math.round(px)));

/**
 * What a table has saved, with anything unusable dropped.
 *
 * The store outlives the code that wrote it: a column can be renamed or
 * removed, and a value can arrive as a string, a null or something that was
 * never a number. None of that may break the table, so each entry is checked
 * on the way in rather than trusted.
 */
export function storedWidths(table: string): Record<string, number> {
  try {
    const raw = localStorage.getItem(key(table));
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, number> = {};
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "number" && Number.isFinite(value)) out[id] = clamp(value);
    }
    return out;
  } catch {
    // A private window, or site data blocked: the table renders at its
    // defaults, which is a worse memory but a working screen.
    return {};
  }
}

/**
 * Column widths for one table, remembered between visits.
 *
 * Keyed by table, like `usePageSize` is by list: widening the client column on
 * the jobs board should still be wide tomorrow, and should not have touched
 * the inventory table on the way.
 */
export function useColumnWidths(table: string, defaults: Record<string, number>) {
  const [saved, setSaved] = useState<Record<string, number>>(() => storedWidths(table));

  const widthOf = useCallback(
    (id: string) => saved[id] ?? defaults[id] ?? COLUMN_MIN_WIDTH,
    [saved, defaults],
  );

  const setWidth = useCallback(
    (id: string, px: number) => {
      setSaved((prev) => {
        const next = { ...prev, [id]: clamp(px) };
        try {
          localStorage.setItem(key(table), JSON.stringify(next));
        } catch {
          // Same as reading: the choice lives for this visit and no longer.
        }
        return next;
      });
    },
    [table],
  );

  const reset = useCallback(() => {
    setSaved({});
    try {
      localStorage.removeItem(key(table));
    } catch {
      // Nothing to clear if nothing could be written.
    }
  }, [table]);

  return { widthOf, setWidth, reset };
}
