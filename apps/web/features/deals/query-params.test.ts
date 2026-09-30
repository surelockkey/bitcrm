import { describe, expect, it } from "vitest";
import { JobSuperStatus } from "@bitcrm/types";
import { toCountsParams, toListParams, type JobsListState } from "./query-params";

const base: JobsListState = {
  tab: JobSuperStatus.SUBMITTED,
  search: "",
  techId: undefined,
  jobTypeId: undefined,
  serviceArea: undefined,
  tagId: undefined,
  businessProfileId: undefined,
  dateFrom: undefined,
  dateTo: undefined,
  hourFrom: undefined,
  hourTo: undefined,
  sort: "none",
};

describe("toListParams — the jobs page asks the server for exactly what it shows", () => {
  it("a status tab reads that status in schedule order, soonest first", () => {
    expect(toListParams(base)).toEqual({
      superStatus: JobSuperStatus.SUBMITTED,
      sort: "schedule",
      dir: "asc",
      limit: 50,
    });
  });

  it("asks for as many rows as the reader chose to see", () => {
    // «По скільки» вибирає людина під таблицею; сторінка лише передає це далі,
    // інакше вибір 100 нічого не міняв би у запиті.
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

  it("a day range becomes the visit-date window", () => {
    expect(toListParams({ ...base, dateFrom: "2026-09-21", dateTo: "2026-09-27" })).toMatchObject({
      scheduledFrom: "2026-09-21",
      scheduledTo: "2026-09-27",
    });
  });

  it("every dropdown filter travels as its own parameter", () => {
    expect(
      toListParams({
        ...base,
        techId: "t1",
        jobTypeId: "jt",
        serviceArea: "Atlanta",
        tagId: "tag",
        businessProfileId: "bp",
        hourFrom: "08:00",
        hourTo: "12:00",
      }),
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

  it("the day sorts flip the direction; the hour sorts stay in schedule order (sorted on the page)", () => {
    expect(toListParams({ ...base, sort: "day_desc" })).toMatchObject({ sort: "schedule", dir: "desc" });
    expect(toListParams({ ...base, sort: "day_asc" })).toMatchObject({ sort: "schedule", dir: "asc" });
    expect(toListParams({ ...base, sort: "hour_desc" })).toMatchObject({ sort: "schedule", dir: "asc" });
  });

  it("a search that looks like a job code goes to the server; free text does not", () => {
    expect(toListParams({ ...base, search: "862N5B" })).toMatchObject({ search: "862N5B" });
    expect(toListParams({ ...base, search: "Smith" })).not.toHaveProperty("search");
  });
});

describe("toCountsParams — the tab numbers ignore the tab itself", () => {
  it("drops the status, the sort and the paging but keeps every filter", () => {
    expect(
      toCountsParams({ ...base, tab: JobSuperStatus.DONE, techId: "t1", dateFrom: "2026-09-23", sort: "day_desc" }),
    ).toEqual({ techId: "t1", scheduledFrom: "2026-09-23", scheduledTo: "2026-09-23" });
  });
});
