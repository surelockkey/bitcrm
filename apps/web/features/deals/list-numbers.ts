import type { DealCounts } from "./api";
import type { JobTab } from "./lib";

/**
 * The numbers the jobs list prints: its tab chips and its pager line.
 *
 * Workiz, searching "Dustin" on Submitted, shows "Submitted 1 · In Progress
 * 6 · Pending 338 …": the open tab counts what was found, every other tab
 * keeps its unsearched number (jobslist_wz_search_Dustin). So the page asks
 * `/deals/counts` once without `q` for all the tabs, and once with it while
 * a search is on — and the open tab takes its number from the second.
 */
export function withSearchedTab(
  base: DealCounts | undefined,
  searched: DealCounts | undefined,
  tab: JobTab,
): DealCounts | undefined {
  if (!base || !searched) return base;
  const others = (base.atLeast ?? []).filter((s) => s !== tab);
  const floor = tab !== "unscheduled" && searched.atLeast?.includes(tab) ? [tab] : [];
  return { ...base, [tab]: searched[tab], atLeast: [...others, ...floor] } as DealCounts;
}

/**
 * "Showing 1 to 50 of 208 results" (list_07_bottom). Nothing found reads
 * "Showing 1 to 0 of 0 results", word for word as Workiz has it. A list the
 * server did not count — a closed status searched without a date window,
 * whose page can also come back short — says only what is on screen:
 * "Showing 1 to 37 results".
 */
export function showingText({
  from,
  to,
  total,
  totalIsFloor,
}: {
  from: number;
  to: number;
  total?: number | null;
  totalIsFloor?: boolean;
}): string {
  const of = typeof total === "number" ? ` of ${total.toLocaleString()}${totalIsFloor ? "+" : ""}` : "";
  return `Showing ${(to === 0 ? 1 : from).toLocaleString()} to ${to.toLocaleString()}${of} results`;
}

/**
 * Whether "›" goes anywhere. The count knows the last page: on it, Next
 * rests even when the list still hands back a cursor (audit L8 — "Page 2 of
 * 1"). Without a count, or with only a floor, the cursor decides.
 */
export function canGoNext({
  page,
  canNext,
  isFetching,
  totalPages,
  totalPagesIsFloor,
}: {
  page: number;
  canNext: boolean;
  isFetching: boolean;
  totalPages?: number;
  totalPagesIsFloor?: boolean;
}): boolean {
  if (!canNext || isFetching) return false;
  if (typeof totalPages === "number" && !totalPagesIsFloor) return page < totalPages;
  return true;
}

/** "Page 1 of 5" — or just "Page 3" when there is no total to divide. */
export function pageText({
  page,
  totalPages,
  totalPagesIsFloor,
}: {
  page: number;
  totalPages?: number;
  totalPagesIsFloor?: boolean;
}): string {
  const of = totalPages === undefined ? "" : ` of ${Math.max(totalPages, 1).toLocaleString()}${totalPagesIsFloor ? "+" : ""}`;
  return `Page ${page.toLocaleString()}${of}`;
}
