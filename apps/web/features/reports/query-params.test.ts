import { describe, expect, it } from "vitest";
import { JobSuperStatus } from "@bitcrm/types";
import { reportCountsParams, reportListParams, type JobsReportState } from "./query-params";

const base: JobsReportState = {
  dateField: "createdAt",
  from: "2026-09-01",
  to: "2026-09-30",
  search: "",
  sort: "none",
  size: 50,
};

describe("reportListParams — the By: field picks the window the server reads", () => {
  it("By: Job created → createdFrom/To, newest first", () => {
    expect(reportListParams(base)).toEqual({ createdFrom: "2026-09-01", createdTo: "2026-09-30", dir: "desc", limit: 50 });
  });

  it("By: Job date → scheduledFrom/To in schedule order", () => {
    expect(reportListParams({ ...base, dateField: "scheduledDate" })).toEqual({
      scheduledFrom: "2026-09-01",
      scheduledTo: "2026-09-30",
      sort: "schedule",
      dir: "desc",
      limit: 50,
    });
  });

  it("By: Job closed → closedFrom/To", () => {
    expect(reportListParams({ ...base, dateField: "closedAt" })).toMatchObject({ closedFrom: "2026-09-01", closedTo: "2026-09-30" });
  });

  it("Day ↑ flips the direction; the hour sorts stay on the server's order", () => {
    expect(reportListParams({ ...base, sort: "day_asc" })).toMatchObject({ dir: "asc" });
    expect(reportListParams({ ...base, sort: "hour_asc" })).toMatchObject({ dir: "desc" });
  });

  it("every filter travels; a job code goes to the server, free text does not", () => {
    const p = reportListParams({
      ...base,
      superStatus: JobSuperStatus.DONE,
      subStatusId: "sub",
      techId: "t",
      createdBy: "u",
      tagId: "tag",
      jobTypeId: "jt",
      sourceId: "src",
      serviceArea: "Atlanta",
      companyId: "co",
      hourFrom: "08:00",
      hourTo: "12:00",
      search: "862n5b",
    });
    expect(p).toMatchObject({
      superStatus: "done",
      subStatusId: "sub",
      techId: "t",
      createdBy: "u",
      tagIds: "tag",
      jobTypeId: "jt",
      sourceId: "src",
      serviceArea: "Atlanta",
      companyId: "co",
      hourFrom: "08:00",
      hourTo: "12:00",
      search: "862N5B",
    });
    expect(reportListParams({ ...base, search: "Smith" })).not.toHaveProperty("search");
  });
});

describe("reportCountsParams — the total the pager shows", () => {
  it("keeps the window and the filters, drops the sort, the size and the search", () => {
    expect(reportCountsParams({ ...base, superStatus: JobSuperStatus.DONE, sort: "day_asc", search: "862N5B" })).toEqual({
      createdFrom: "2026-09-01",
      createdTo: "2026-09-30",
      superStatus: "done",
    });
  });
});
