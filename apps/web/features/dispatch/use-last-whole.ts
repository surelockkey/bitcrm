"use client";

import { useState } from "react";

/**
 * What a live board shows while it is asked for again under the reader: the
 * current answer once all of it is in, and until then the last answer that
 * was whole — `undefined` only before the first one.
 *
 * `usePageReady` holds a page behind its skeleton until the first answer is
 * in. A board does more than that: another day or another set of statuses is
 * a new set of jobs, whose clients' names, technicians' streets and calendar
 * events each arrive a beat apart. Drawn as they came, the grid would empty,
 * fill with "Unknown client" and then correct itself; held, it simply turns
 * over to the new day once that day is complete.
 *
 * `value` must keep its identity between renders while nothing in it changes
 * (build it with `useMemo`): a new object on every render reads as a new
 * answer every time.
 */
export function useLastWhole<T>(value: T, whole: boolean): T | undefined {
  const [kept, setKept] = useState<T | undefined>(undefined);
  // Set during render, as usePageReady does: the frame that has the whole
  // answer is the frame that shows it.
  if (whole && kept !== value) setKept(value);
  return whole ? value : kept;
}
