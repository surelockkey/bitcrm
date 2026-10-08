import { describe, expect, it } from "vitest";
import { JobSuperStatus } from "@bitcrm/types";
import {
  EMPTY_JOBS_LIST_STATE,
  JOBS_LIST_CAPS,
  jobsSearchRoute,
  toCountsParams,
  toListParams,
  toSearchCountsParams,
  type JobsListCaps,
  type JobsListState,
} from "./query-params";

const base: JobsListState = { ...EMPTY_JOBS_LIST_STATE };

/** An older backend (main 8b16d4c8): one value per filter, no unpaid, no free text. */
const old: JobsListCaps = { multiValue: false, unpaid: false, textSearch: false };
/** main 974cf6d8 (`backend/jobs-list-search`): any-of lists, `unpaid`, and `q`. */
const now: JobsListCaps = { multiValue: true, unpaid: true, textSearch: true };

describe("the jobs list's capabilities", () => {
  it("ships with main 974cf6d8's backend: any-of lists, unpaid=true and q", () => {
    expect(JOBS_LIST_CAPS).toEqual(now);
  });
});

describe("toListParams — the jobs page asks the server for exactly what it shows", () => {
  it("opens on Submitted, in schedule order, soonest first", () => {
    expect(base.tab).toBe(JobSuperStatus.SUBMITTED);
    expect(toListParams(base)).toEqual({
      superStatus: JobSuperStatus.SUBMITTED,
      sort: "schedule",
      dir: "asc",
      limit: 50,
    });
  });

  it("asks for as many rows as the reader chose to see", () => {
    expect(toListParams(base, 100)).toMatchObject({ limit: 100 });
  });

  it("the unscheduled tab asks for the undated jobs, no status", () => {
    expect(toListParams({ ...base, tab: "unscheduled" })).toEqual({
      unscheduled: true,
      sort: "schedule",
      dir: "asc",
      limit: 50,
    });
  });

  it("a closed status chosen in Filter results is the status asked for", () => {
    expect(toListParams({ ...base, tab: JobSuperStatus.DONE })).toMatchObject({ superStatus: "done" });
    expect(toListParams({ ...base, tab: JobSuperStatus.CANCELED })).toMatchObject({ superStatus: "canceled" });
  });

  it("a day range becomes the visit-date window; one day alone is that day", () => {
    expect(toListParams({ ...base, dateFrom: "2026-09-21", dateTo: "2026-09-27" })).toMatchObject({
      scheduledFrom: "2026-09-21",
      scheduledTo: "2026-09-27",
    });
    expect(toListParams({ ...base, dateFrom: "2026-09-21" })).toMatchObject({
      scheduledFrom: "2026-09-21",
      scheduledTo: "2026-09-21",
    });
  });

  it("several values per group travel as any-of lists (Workiz: OR inside a group)", () => {
    const p = toListParams({
      ...base,
      techIds: ["t1", "t2"],
      jobTypeIds: ["jt1", "jt2"],
      serviceAreas: ["A", "B"],
      tagIds: ["a", "b"],
      businessProfileIds: ["bp1", "bp2"],
      hourFrom: "08:00",
      hourTo: "12:00",
    });
    expect(p).toMatchObject({
      techIds: "t1,t2",
      jobTypeIds: "jt1,jt2",
      serviceAreas: "A,B",
      tagIds: "a,b",
      tagMatch: "any",
      businessProfileIds: "bp1,bp2",
      hourFrom: "08:00",
      hourTo: "12:00",
    });
    expect(p).not.toHaveProperty("techId");
    expect(p).not.toHaveProperty("jobTypeId");
    expect(p).not.toHaveProperty("serviceArea");
    expect(p).not.toHaveProperty("businessProfileId");
  });

  it("one value is a list of one — the any-of parameters take a single value too", () => {
    expect(toListParams({ ...base, techIds: ["t1"], tagIds: ["a"] })).toMatchObject({
      techIds: "t1",
      tagIds: "a",
      tagMatch: "any",
    });
  });

  it("an older backend gets one value per group, as single-value parameters", () => {
    const p = toListParams({ ...base, tagIds: ["a", "b"], techIds: ["t1", "t2"], serviceAreas: ["A"] }, 50, old);
    expect(p).toMatchObject({ tagIds: "a", techId: "t1", serviceArea: "A" });
    expect(p).not.toHaveProperty("techIds");
    expect(p).not.toHaveProperty("tagMatch");
  });

  it("“Show unpaid jobs” travels as unpaid=true", () => {
    expect(toListParams({ ...base, unpaid: true })).toMatchObject({ unpaid: true });
    expect(toListParams({ ...base, unpaid: false })).not.toHaveProperty("unpaid");
    expect(toListParams({ ...base, unpaid: true }, 50, old)).not.toHaveProperty("unpaid");
  });

  it("the day sorts flip the direction; the hour sorts stay in schedule order (sorted on the page)", () => {
    expect(toListParams({ ...base, sort: "day_desc" })).toMatchObject({ sort: "schedule", dir: "desc" });
    expect(toListParams({ ...base, sort: "day_asc" })).toMatchObject({ sort: "schedule", dir: "asc" });
    expect(toListParams({ ...base, sort: "hour_desc" })).toMatchObject({ sort: "schedule", dir: "asc" });
  });

  /**
   * Workiz sends whatever is in the box (`sSearch`), inside the tab. So does
   * ours: `q`, which matches the Job ID as well — a code included, so the tab
   * number counted under the same `q` agrees with the rows.
   */
  it("the Search box's text is q, trimmed, inside the tab — a job code too", () => {
    expect(toListParams({ ...base, search: " Dustin " })).toMatchObject({ q: "Dustin", superStatus: "submitted" });
    expect(toListParams({ ...base, search: "5TU7ZA" })).toMatchObject({ q: "5TU7ZA" });
    expect(toListParams({ ...base, search: "5TU7ZA" })).not.toHaveProperty("search");
    expect(toListParams({ ...base, search: "   " })).not.toHaveProperty("q");
  });

  it("an older backend looks up a job code by itself and ignores other text", () => {
    expect(toListParams({ ...base, search: " 862n5b " }, 50, old)).toMatchObject({ search: "862N5B" });
    expect(toListParams({ ...base, search: "Smith" }, 50, old)).not.toHaveProperty("search");
    expect(toListParams({ ...base, search: "Smith" }, 50, old)).not.toHaveProperty("q");
  });

  it("q is at most 200 characters, as the server takes it", () => {
    expect(toListParams({ ...base, search: "x".repeat(250) }).q).toHaveLength(200);
  });
});

describe("jobsSearchRoute — where the Search box's text is answered", () => {
  it("nothing typed is no search", () => {
    expect(jobsSearchRoute("", now)).toBe("none");
    expect(jobsSearchRoute("   ", now)).toBe("none");
  });

  it("any text is the list's own q", () => {
    for (const q of ["Dustin", "469 396", "5TU7", "#5TU7", "5TU7ZA", "JJENBF"]) expect(jobsSearchRoute(q, now), q).toBe("list");
  });

  /**
   * "Dustin" is six letters, "396817" six digits: shaped like a code, but a
   * name and a phone fragment. Only letters mixed with digits is surely a code.
   */
  it("an older backend: only a sure code is searched", () => {
    expect(jobsSearchRoute("MS9277", old)).toBe("code");
    expect(jobsSearchRoute("Dustin", old)).toBe("none");
    expect(jobsSearchRoute("396817", old)).toBe("none");
  });
});

describe("toCountsParams — the tab numbers, as Workiz shows them", () => {
  it("drop the status, the sort, the search and the paging but keep every filter", () => {
    expect(
      toCountsParams({ ...base, tab: JobSuperStatus.DONE, techIds: ["t1"], dateFrom: "2026-09-23", sort: "day_desc", search: "5TU7ZA" }),
    ).toEqual({ techIds: "t1", scheduledFrom: "2026-09-23", scheduledTo: "2026-09-23" });
  });

  it("carry unpaid", () => {
    expect(toCountsParams({ ...base, unpaid: true })).toEqual({ unpaid: true });
  });
});

describe("toSearchCountsParams — the one extra count a search asks for", () => {
  it("is the same filters plus q", () => {
    expect(toSearchCountsParams({ ...base, techIds: ["t1"], search: " Dustin " })).toEqual({ techIds: "t1", q: "Dustin" });
  });

  it("is nothing without a search", () => {
    expect(toSearchCountsParams({ ...base, techIds: ["t1"], search: "  " })).toBeNull();
  });

  it("is nothing on a backend without q", () => {
    expect(toSearchCountsParams({ ...base, search: "Dustin" }, old)).toBeNull();
  });
});
