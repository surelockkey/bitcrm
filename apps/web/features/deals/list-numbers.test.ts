import { describe, expect, it } from "vitest";
import { JobSuperStatus } from "@bitcrm/types";
import type { DealCounts } from "./api";
import { withSearchedTab } from "./list-numbers";

const counts = (over: Partial<DealCounts> = {}): DealCounts => ({
  submitted: 210,
  in_progress: 5,
  pending: 331,
  done_pending_approval: 186,
  done: 1325,
  canceled: 3245,
  unscheduled: 36,
  total: 5302,
  atLeast: [],
  ...over,
});

/**
 * Workiz, searching "Dustin" on Submitted: "Submitted 1 · In Progress 6 ·
 * Pending 338 …" — the open tab counts what was found, every other tab keeps
 * its unsearched number (jobslist_wz_search_Dustin).
 *
 * The pager's words and its "no page past the counted last one" rule live in
 * the kit now (components/workiz/pager: wzPagerSummary, wzPagerPages,
 * wzPagerCanNext).
 */
describe("withSearchedTab — the tab numbers while a search is on", () => {
  it("without a search, the tabs are the plain counts", () => {
    const base = counts();
    expect(withSearchedTab(base, undefined, JobSuperStatus.SUBMITTED)).toBe(base);
  });

  it("the open tab takes the searched number; the others keep theirs", () => {
    const searched = counts({ submitted: 1, in_progress: 0, pending: 2, done: null, canceled: null, total: null });
    expect(withSearchedTab(counts(), searched, JobSuperStatus.SUBMITTED)).toEqual(counts({ submitted: 1 }));
  });

  it("works for the Unscheduled tab too", () => {
    const searched = counts({ unscheduled: 3 });
    expect(withSearchedTab(counts(), searched, "unscheduled")?.unscheduled).toBe(3);
  });

  it("a searched number the server would not count stays unknown (null), not the unsearched one", () => {
    // q on a closed status with no visit-date window: the server answers null.
    const searched = counts({ done: null, canceled: null, total: null });
    expect(withSearchedTab(counts(), searched, JobSuperStatus.DONE)?.done).toBeNull();
  });

  it("the floor mark follows the open tab's searched number", () => {
    const base = counts({ pending: 10_000, atLeast: [JobSuperStatus.PENDING, "total"] });
    const searched = counts({ pending: 12, atLeast: [] });
    expect(withSearchedTab(base, searched, JobSuperStatus.PENDING)?.atLeast).toEqual(["total"]);
    const floored = counts({ pending: 10_000, atLeast: [JobSuperStatus.PENDING] });
    expect(withSearchedTab(counts(), floored, JobSuperStatus.PENDING)?.atLeast).toEqual([JobSuperStatus.PENDING]);
  });

  it("nothing yet without the plain counts", () => {
    expect(withSearchedTab(undefined, counts(), JobSuperStatus.SUBMITTED)).toBeUndefined();
  });
});
