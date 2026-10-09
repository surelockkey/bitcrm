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

