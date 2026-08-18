import { describe, it, expect } from "vitest";
import {
  ClientType,
  DealPriority,
  DealStatus,
  JobSuperStatus,
} from "@bitcrm/types";
import type { Deal } from "@bitcrm/types";
import { datePresetRange, filterJobsReport, jobsReportCsv, paginate } from "./lib";

function deal(over: Partial<Deal>): Deal {
  return {
    id: "d1",
    dealNumber: "AAAAAA",
    contactId: "c1",
    clientType: ClientType.RESIDENTIAL,
    serviceArea: "Phoenix",
    address: { street: "1 Main", city: "Phoenix", state: "AZ", zip: "85001" },
    jobTypeId: "jt-1",
    superStatus: JobSuperStatus.SUBMITTED,
    assignedDispatcherId: "u1",
    priority: DealPriority.NORMAL,
    assignedTechIds: [],
    tagIds: [],
    status: DealStatus.ACTIVE,
    createdBy: "u1",
    createdAt: "2026-08-10T10:00:00.000Z",
    updatedAt: "",
    ...over,
  };
}

const names = new Map<string, string>();

describe("filterJobsReport", () => {
  const rows = [
    deal({ id: "a", dealNumber: "A11111", companyId: "co-1", createdBy: "u1", createdAt: "2026-08-10T10:00:00.000Z", scheduledDate: "2026-08-20" }),
    deal({ id: "b", dealNumber: "B22222", companyId: "co-2", createdBy: "u2", createdAt: "2026-08-15T10:00:00.000Z", scheduledDate: "2026-08-11" }),
    deal({ id: "c", dealNumber: "C33333", createdBy: "u1", createdAt: "2026-08-17T10:00:00.000Z" }),
  ];

  it("filters by company and by creator", () => {
    expect(filterJobsReport(rows, { companyId: "co-1" }, names).map((d) => d.id)).toEqual(["a"]);
    expect(filterJobsReport(rows, { createdBy: "u1" }, names).map((d) => d.id)).toEqual(["a", "c"]);
  });

  it("filters by an inclusive date range on the chosen field", () => {
    expect(
      filterJobsReport(rows, { dateField: "createdAt", dateFrom: "2026-08-15", dateTo: "2026-08-17" }, names).map((d) => d.id),
    ).toEqual(["b", "c"]);
    // Same range against the scheduled date instead.
    expect(
      filterJobsReport(rows, { dateField: "scheduledDate", dateFrom: "2026-08-11", dateTo: "2026-08-15" }, names).map((d) => d.id),
    ).toEqual(["b"]);
  });

  it("drops undated deals when the range is on the scheduled date", () => {
    expect(
      filterJobsReport(rows, { dateField: "scheduledDate", dateFrom: "2026-01-01", dateTo: "2026-12-31" }, names).map((d) => d.id),
    ).toEqual(["a", "b"]);
  });

  it("filters by the closedAt day when the field is closedAt", () => {
    const closedRows = [
      deal({ id: "x", closedAt: "2026-08-12T12:00:00.000Z" }),
      deal({ id: "y", closedAt: "2026-08-20T12:00:00.000Z" }),
      deal({ id: "z", closedAt: undefined }),
    ];
    expect(
      filterJobsReport(closedRows, { dateField: "closedAt", dateFrom: "2026-08-15", dateTo: "2026-08-25" }, names).map((d) => d.id),
    ).toEqual(["y"]);
  });

  it("keeps the base deal filters working (super-status etc.)", () => {
    const mixed = [...rows, deal({ id: "x", superStatus: JobSuperStatus.CANCELED })];
    expect(
      filterJobsReport(mixed, { superStatus: JobSuperStatus.CANCELED }, names).map((d) => d.id),
    ).toEqual(["x"]);
  });
});

describe("paginate", () => {
  const items = Array.from({ length: 12 }, (_, i) => i + 1);

  it("slices the requested page and reports totals", () => {
    const p = paginate(items, 2, 10);
    expect(p.rows).toEqual([11, 12]);
    expect(p.pages).toBe(2);
    expect(p.total).toBe(12);
  });

  it("clamps an out-of-range page", () => {
    expect(paginate(items, 99, 10).rows).toEqual([11, 12]);
    expect(paginate([], 3, 10).rows).toEqual([]);
  });
});

describe("datePresetRange", () => {
  // A Tuesday.
  const today = "2026-08-18";

  it("this week runs Monday through today, Workiz-style", () => {
    expect(datePresetRange("this_week", today)).toEqual({ from: "2026-08-17", to: "2026-08-18" });
  });

  it("today, this month and all-time behave sanely", () => {
    expect(datePresetRange("today", today)).toEqual({ from: "2026-08-18", to: "2026-08-18" });
    expect(datePresetRange("this_month", today)).toEqual({ from: "2026-08-01", to: "2026-08-18" });
    expect(datePresetRange("all", today)).toEqual({});
  });
});

describe("jobsReportCsv", () => {
  it("emits a header and quotes commas", () => {
    const csv = jobsReportCsv([
      { "Job #": "A11111", Client: "Smith, Jane", Total: "$10.00" },
    ]);
    const [header, row] = csv.split("\n");
    expect(header).toBe("Job #,Client,Total");
    expect(row).toBe('A11111,"Smith, Jane",$10.00');
  });
});
