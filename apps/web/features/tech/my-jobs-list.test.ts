import { describe, expect, it } from "vitest";
import { JobSuperStatus } from "@bitcrm/types";
import { EMPTY_JOBS_LIST_STATE, toCountsParams, toListParams } from "@/features/deals/query-params";
import type { FilterCatalogs } from "@/features/deals/job-filters";
import { myJobHref, myJobsCatalogs, myJobsListState } from "./my-jobs-list";

describe("myJobsListState — the jobs list, only the viewer's jobs", () => {
  it("asks for the viewer's jobs whatever the controls hold", () => {
    const state = { ...EMPTY_JOBS_LIST_STATE, techIds: ["someone-else", "t2"] };
    expect(myJobsListState(state, "t1").techIds).toEqual(["t1"]);
  });

  it("keeps every other control as it is: tab, search, filters, sort, unpaid", () => {
    const state = {
      ...EMPTY_JOBS_LIST_STATE,
      tab: JobSuperStatus.IN_PROGRESS,
      search: "Dustin",
      tagIds: ["tag-1"],
      jobTypeIds: ["jt-1"],
      serviceAreas: ["North"],
      sort: "day_desc" as const,
      unpaid: true,
    };
    expect(myJobsListState(state, "t1")).toEqual({ ...state, techIds: ["t1"] });
  });

  it("sends the viewer as the list's and the tabs' tech filter", () => {
    const mine = myJobsListState(EMPTY_JOBS_LIST_STATE, "t1");
    expect(toListParams(mine).techIds).toBe("t1");
    expect(toCountsParams(mine).techIds).toBe("t1");
  });
});

describe("myJobsCatalogs — Filter results without a TECHS column", () => {
  it("drops the technicians (the list is always yours) and keeps the rest", () => {
    const catalogs: FilterCatalogs = {
      techs: [{ id: "t1", name: "Tess Tech" }],
      tags: [{ id: "tag-1", name: "Needs a call", color: "blue" } as FilterCatalogs["tags"][number]],
      jobTypes: [{ id: "jt-1", name: "Lockout" }],
      areas: [{ name: "North" }],
      companies: [{ id: "bp-1", name: "SureLock" }],
    };
    expect(myJobsCatalogs(catalogs)).toEqual({ ...catalogs, techs: [] });
  });
});

describe("myJobHref", () => {
  it("opens the job on the technician's own route", () => {
    expect(myJobHref("d-42")).toBe("/my-jobs/d-42");
  });
});
