import { describe, expect, it } from "vitest";
import { JobSuperStatus } from "@bitcrm/types";
import {
  EMPTY_JOBS_LIST_STATE,
  JOBS_LIST_CAPS,
  jobsSearchRoute,
  toCountsParams,
  toListParams,
  type JobsListCaps,
  type JobsListState,
} from "./query-params";

const base: JobsListState = { ...EMPTY_JOBS_LIST_STATE };

/** A backend before `unpaid=true` (main 8b16d4c8): one value per filter, no unpaid, no free text. */
const today: JobsListCaps = { multiValue: false, unpaid: false, textSearch: false };
/** What it serves once it takes every parameter the Workiz control needs. */
const later: JobsListCaps = { multiValue: true, unpaid: true, textSearch: true };

describe("the jobs list's capabilities", () => {
  it("ships with main 03eb84e2's backend: unpaid=true, one value per filter, no free-text list search", () => {
    expect(JOBS_LIST_CAPS).toEqual({ multiValue: false, unpaid: true, textSearch: false });
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

  it("today: each filter travels as its own single-value parameter", () => {
    expect(
      toListParams(
        {
          ...base,
          techIds: ["t1"],
          jobTypeIds: ["jt"],
          serviceAreas: ["Atlanta"],
          tagIds: ["tag"],
          businessProfileIds: ["bp"],
          hourFrom: "08:00",
          hourTo: "12:00",
        },
        50,
        today,
      ),
    ).toMatchObject({
      techId: "t1",
      jobTypeId: "jt",
      serviceArea: "Atlanta",
      tagIds: "tag",
      businessProfileId: "bp",
      hourFrom: "08:00",
      hourTo: "12:00",
    });
  });

  it("today: never sends two tags — the server would read them as all-of, Workiz means any-of", () => {
    const p = toListParams({ ...base, tagIds: ["a", "b"], techIds: ["t1", "t2"] }, 50, today);
    expect(p.tagIds).toBe("a");
    expect(p.techId).toBe("t1");
    expect(p).not.toHaveProperty("techIds");
  });

  it("later: several values per group travel as any-of lists", () => {
    const p = toListParams(
      {
        ...base,
        techIds: ["t1", "t2"],
        jobTypeIds: ["jt1", "jt2"],
        serviceAreas: ["A", "B"],
        tagIds: ["a", "b"],
        businessProfileIds: ["bp1", "bp2"],
      },
      50,
      later,
    );
    expect(p).toMatchObject({
      techIds: "t1,t2",
      jobTypeIds: "jt1,jt2",
      serviceAreas: "A,B",
      tagIds: "a,b",
      tagMatch: "any",
      businessProfileIds: "bp1,bp2",
    });
    expect(p).not.toHaveProperty("techId");
    expect(p).not.toHaveProperty("jobTypeId");
  });

  it("“Show unpaid jobs” travels only once the server can answer it", () => {
    expect(toListParams({ ...base, unpaid: true }, 50, today)).not.toHaveProperty("unpaid");
    expect(toListParams({ ...base, unpaid: true }, 50, later)).toMatchObject({ unpaid: true });
    expect(toListParams({ ...base, unpaid: false }, 50, later)).not.toHaveProperty("unpaid");
  });

  it("the day sorts flip the direction; the hour sorts stay in schedule order (sorted on the page)", () => {
    expect(toListParams({ ...base, sort: "day_desc" })).toMatchObject({ sort: "schedule", dir: "desc" });
    expect(toListParams({ ...base, sort: "day_asc" })).toMatchObject({ sort: "schedule", dir: "asc" });
    expect(toListParams({ ...base, sort: "hour_desc" })).toMatchObject({ sort: "schedule", dir: "asc" });
  });

  it("a search that looks like a job code goes to the server; free text does not, today", () => {
    expect(toListParams({ ...base, search: " 862n5b " }, 50, today)).toMatchObject({ search: "862N5B" });
    expect(toListParams({ ...base, search: "Smith" }, 50, today)).not.toHaveProperty("search");
    expect(toListParams({ ...base, search: "Smith" }, 50, today)).not.toHaveProperty("q");
  });

  it("later: free text is the list's own `q`, inside the tab", () => {
    expect(toListParams({ ...base, search: " Dustin " }, 50, later)).toMatchObject({
      q: "Dustin",
      superStatus: "submitted",
    });
    expect(toListParams({ ...base, search: "5TU7ZA" }, 50, later)).toMatchObject({ search: "5TU7ZA" });
    expect(toListParams({ ...base, search: "5TU7ZA" }, 50, later)).not.toHaveProperty("q");
  });
});

describe("jobsSearchRoute — where the Search box's text is answered", () => {
  it("nothing typed is no search", () => {
    expect(jobsSearchRoute("", today)).toBe("none");
    expect(jobsSearchRoute("   ", today)).toBe("none");
  });

  it("a six-character job code is looked up by the list itself", () => {
    expect(jobsSearchRoute("5tu7za", today)).toBe("code");
    expect(jobsSearchRoute("5TU7ZA", later)).toBe("code");
  });

  it("today, any other text goes to the search service", () => {
    expect(jobsSearchRoute("Dustin", today)).toBe("service");
    expect(jobsSearchRoute("469 396", today)).toBe("service");
    expect(jobsSearchRoute("5TU7", today)).toBe("service");
  });

  /**
   * "Dustin" is six letters, "396817" six digits: shaped like a code, but a
   * name and a phone fragment. Only letters mixed with digits is surely a
   * code; an all-letter code (JJENBF) still turns up through the search
   * service, which indexes the Job ID too.
   */
  it("six letters, or six digits, is not taken for a code", () => {
    expect(jobsSearchRoute("Dustin", today)).toBe("service");
    expect(jobsSearchRoute("JJENBF", today)).toBe("service");
    expect(jobsSearchRoute("396817", today)).toBe("service");
    expect(jobsSearchRoute("MS9277", today)).toBe("code");
  });

  it("once the list searches text itself, it goes there", () => {
    expect(jobsSearchRoute("Dustin", later)).toBe("list");
  });
});

describe("toCountsParams — the tab numbers ignore the tab itself", () => {
  it("drops the status, the sort, the search and the paging but keeps every filter", () => {
    expect(
      toCountsParams(
        { ...base, tab: JobSuperStatus.DONE, techIds: ["t1"], dateFrom: "2026-09-23", sort: "day_desc", search: "5TU7ZA" },
        today,
      ),
    ).toEqual({ techId: "t1", scheduledFrom: "2026-09-23", scheduledTo: "2026-09-23" });
  });

  it("carries unpaid once the server can count it", () => {
    expect(toCountsParams({ ...base, unpaid: true }, later)).toEqual({ unpaid: true });
    expect(toCountsParams({ ...base, unpaid: true }, today)).toEqual({});
  });
});
