import { describe, expect, it } from "vitest";
import { JobSuperStatus } from "@bitcrm/types";
import type { DealCounts } from "./api";
import { pageText, showingText, withSearchedTab } from "./list-numbers";

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

/** Workiz's pager line (list_07_bottom, jobslist_wz_search_zzqxwv). */
describe("showingText", () => {
  it("rows on screen out of the counted total", () => {
    expect(showingText({ from: 1, to: 50, total: 208 })).toBe("Showing 1 to 50 of 208 results");
    expect(showingText({ from: 51, to: 100, total: 1325 })).toBe("Showing 51 to 100 of 1,325 results");
  });

  it("nothing found reads the way Workiz says it", () => {
    expect(showingText({ from: 0, to: 0, total: 0 })).toBe("Showing 1 to 0 of 0 results");
  });

  it("a number the server stopped counting is a floor", () => {
    expect(showingText({ from: 1, to: 50, total: 10_000, totalIsFloor: true })).toBe("Showing 1 to 50 of 10,000+ results");
  });

  /**
   * A closed status searched without a date window is not counted, and its
   * page can come back short. The line then says only what is on screen.
   */
  it("an uncounted list says what is on screen and nothing it does not know", () => {
    expect(showingText({ from: 1, to: 37, total: null })).toBe("Showing 1 to 37 results");
    expect(showingText({ from: 1, to: 37, total: undefined })).toBe("Showing 1 to 37 results");
  });
});

describe("pageText", () => {
  it("Page N of M when the total is known", () => {
    expect(pageText({ page: 1, totalPages: 5 })).toBe("Page 1 of 5");
    expect(pageText({ page: 2, totalPages: 200, totalPagesIsFloor: true })).toBe("Page 2 of 200+");
  });

  it("just Page N when it is not", () => {
    expect(pageText({ page: 3, totalPages: undefined })).toBe("Page 3");
  });
});
