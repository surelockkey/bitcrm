import { describe, it, expect } from "vitest";
import {
  JobSuperStatus,
  DealPriority,
  DealStatus,
  ClientType,
} from "@bitcrm/types";
import type { Deal, DealProduct } from "@bitcrm/types";
import {
  superStatusLabel,
  groupLabel,
  isTerminalStatus,
  priorityLabel,
  isUrgent,
  formatMoney,
  dealTotal,
  priceRange,
  isPriceInBand,
  filterDeals,
  datePresetRange,
  scheduleRelative,
  JOB_TABS,
  jobTabLabel,
  matchesTab,
  tabCounts,
} from "./lib";

function deal(over: Partial<Deal> = {}): Deal {
  return {
    id: "d1",
    dealNumber: 1042,
    contactId: "c1",
    clientType: ClientType.RESIDENTIAL,
    serviceArea: "Phoenix",
    address: { street: "1 Main", city: "Phoenix", state: "AZ", zip: "85001" },
    jobTypeId: "jt-lockout",
    superStatus: JobSuperStatus.SUBMITTED,
    assignedDispatcherId: "u1",
    priority: DealPriority.NORMAL,
    assignedTechIds: [],
    tagIds: [],
    status: DealStatus.ACTIVE,
    createdBy: "u1",
    createdAt: "",
    updatedAt: "",
    ...over,
  };
}

function product(over: Partial<DealProduct> = {}): DealProduct {
  return {
    productId: "p1",
    name: "Deadbolt",
    sku: "LOCK-1",
    quantity: 1,
    costCompany: 10,
    costForTech: 18,
    priceClient: 45,
    addedBy: "u1",
    addedAt: "",
    ...over,
  };
}

describe("super-status helpers", () => {
  it("labels super-statuses", () => {
    expect(superStatusLabel(JobSuperStatus.SUBMITTED)).toBe("Submitted");
    expect(superStatusLabel(JobSuperStatus.IN_PROGRESS)).toBe("In Progress");
    expect(superStatusLabel(JobSuperStatus.DONE_PENDING_APPROVAL)).toBe("Done Pending Approval");
  });
  it("groupLabel aliases the super-status labels", () => {
    expect(groupLabel(JobSuperStatus.PENDING)).toBe("Pending");
    expect(groupLabel(JobSuperStatus.CANCELED)).toBe("Canceled");
  });
  it("knows terminal super-statuses", () => {
    expect(isTerminalStatus(JobSuperStatus.DONE)).toBe(true);
    expect(isTerminalStatus(JobSuperStatus.DONE_PENDING_APPROVAL)).toBe(true);
    expect(isTerminalStatus(JobSuperStatus.CANCELED)).toBe(true);
    expect(isTerminalStatus(JobSuperStatus.IN_PROGRESS)).toBe(false);
  });
});

describe("labels", () => {
  it("labels priority + urgency", () => {
    expect(priorityLabel(DealPriority.URGENT)).toBe("Urgent");
    expect(isUrgent(deal({ priority: DealPriority.URGENT }))).toBe(true);
    expect(isUrgent(deal())).toBe(false);
  });
});

describe("money", () => {
  it("formats dollars", () => {
    expect(formatMoney(140)).toBe("$140.00");
    expect(formatMoney(45.5)).toBe("$45.50");
  });
  it("sums line items", () => {
    expect(dealTotal([product({ quantity: 2, priceClient: 45 }), product({ priceClient: 95 })])).toBe(185);
    expect(dealTotal([])).toBe(0);
  });
});

describe("price band (±15%)", () => {
  it("computes the allowed range off catalog price", () => {
    const r = priceRange(45);
    expect(r.min).toBeCloseTo(38.25, 2);
    expect(r.max).toBeCloseTo(51.75, 2);
  });
  it("validates a price against the band", () => {
    expect(isPriceInBand(45, 45)).toBe(true);
    expect(isPriceInBand(50, 45)).toBe(true);
    expect(isPriceInBand(52, 45)).toBe(false);
    expect(isPriceInBand(38, 45)).toBe(false);
  });
});

describe("filterDeals", () => {
  const names = new Map<string, string>([["c1", "Jane Smith"], ["c2", "Marcus Reyes"]]);
  const list = [
    deal({ id: "a", dealNumber: 1042, contactId: "c1", superStatus: JobSuperStatus.SUBMITTED, priority: DealPriority.URGENT, jobTypeId: "jt-lockout" }),
    deal({ id: "b", dealNumber: 1040, contactId: "c2", superStatus: JobSuperStatus.IN_PROGRESS, jobTypeId: "jt-rekey", assignedTechIds: ["t9"] }),
  ];
  it("returns all with no filters", () => {
    expect(filterDeals(list, {}, names)).toHaveLength(2);
  });
  it("filters by super-status and priority", () => {
    expect(filterDeals(list, { superStatus: JobSuperStatus.SUBMITTED }, names).map((d) => d.id)).toEqual(["a"]);
    expect(filterDeals(list, { priority: DealPriority.URGENT }, names).map((d) => d.id)).toEqual(["a"]);
  });
  it("searches by deal number and client name", () => {
    expect(filterDeals(list, { search: "1040" }, names).map((d) => d.id)).toEqual(["b"]);
    expect(filterDeals(list, { search: "jane" }, names).map((d) => d.id)).toEqual(["a"]);
    expect(filterDeals(list, { search: "#1042" }, names).map((d) => d.id)).toEqual(["a"]);
  });

  it("filters by service area (exact)", () => {
    const areas = [
      deal({ id: "atl", serviceArea: "Atlanta Metro" }),
      deal({ id: "nga", serviceArea: "North GA" }),
    ];
    expect(filterDeals(areas, { serviceArea: "North GA" }, names).map((d) => d.id)).toEqual(["nga"]);
  });

  it("filters by status group", () => {
    // a = Submitted, b = In Progress
    expect(
      filterDeals(list, { statusGroups: [JobSuperStatus.SUBMITTED] }, names).map((d) => d.id),
    ).toEqual(["a"]);
    expect(filterDeals(list, { statusGroups: [] }, names)).toHaveLength(2);
  });

  it("datePresetRange maps presets to ranges", () => {
    expect(datePresetRange("all", "2026-07-16")).toEqual({});
    expect(datePresetRange("today", "2026-07-16")).toEqual({ from: "2026-07-16", to: "2026-07-16" });
    // 2026-07-16 is a Thursday → week is Mon 13th … Sun 19th
    expect(datePresetRange("week", "2026-07-16")).toEqual({ from: "2026-07-13", to: "2026-07-19" });
  });

  it("filters by scheduled-date range and excludes undated deals", () => {
    const dated = [
      deal({ id: "mon", scheduledDate: "2026-07-13" }),
      deal({ id: "wed", scheduledDate: "2026-07-15" }),
      deal({ id: "none" }),
    ];
    expect(
      filterDeals(dated, { dateFrom: "2026-07-14", dateTo: "2026-07-16" }, names).map((d) => d.id),
    ).toEqual(["wed"]);
  });
});

describe("status tabs", () => {
  const names = new Map<string, string>();
  it("orders the 6 super-statuses then unscheduled, and labels them", () => {
    expect(JOB_TABS).toEqual([
      JobSuperStatus.SUBMITTED,
      JobSuperStatus.IN_PROGRESS,
      JobSuperStatus.DONE,
      JobSuperStatus.PENDING,
      JobSuperStatus.DONE_PENDING_APPROVAL,
      JobSuperStatus.CANCELED,
      "unscheduled",
    ]);
    expect(jobTabLabel(JobSuperStatus.IN_PROGRESS)).toBe("In Progress");
    expect(jobTabLabel("unscheduled")).toBe("Unscheduled");
  });

  it("matchesTab: super-status by status, unscheduled by missing date", () => {
    const submittedDated = deal({ superStatus: JobSuperStatus.SUBMITTED, scheduledDate: "2026-07-13" });
    const submittedUndated = deal({ superStatus: JobSuperStatus.SUBMITTED });
    expect(matchesTab(submittedDated, JobSuperStatus.SUBMITTED)).toBe(true);
    expect(matchesTab(submittedDated, "unscheduled")).toBe(false);
    expect(matchesTab(submittedUndated, "unscheduled")).toBe(true);
    // Unscheduled overlaps its status tab — a deal can appear in both.
    expect(matchesTab(submittedUndated, JobSuperStatus.SUBMITTED)).toBe(true);
  });

  it("tabCounts counts each tab independently (overlapping)", () => {
    const list = [
      deal({ superStatus: JobSuperStatus.SUBMITTED, scheduledDate: "2026-07-13" }), // submitted, scheduled
      deal({ superStatus: JobSuperStatus.SUBMITTED }), // submitted, unscheduled
      deal({ superStatus: JobSuperStatus.IN_PROGRESS, scheduledDate: "2026-07-14" }), // in progress
      deal({ superStatus: JobSuperStatus.DONE }), // done, unscheduled
    ];
    const c = tabCounts(list);
    expect(c[JobSuperStatus.SUBMITTED]).toBe(2);
    expect(c[JobSuperStatus.IN_PROGRESS]).toBe(1);
    expect(c[JobSuperStatus.DONE]).toBe(1);
    expect(c.unscheduled).toBe(2);
  });

  it("scheduleRelative labels dates relative to today", () => {
    expect(scheduleRelative(undefined, "2026-07-16")).toBeNull();
    expect(scheduleRelative("2026-07-16", "2026-07-16")).toEqual({ label: "Today", tone: "soon" });
    expect(scheduleRelative("2026-07-17", "2026-07-16")).toEqual({ label: "Tomorrow", tone: "ok" });
    expect(scheduleRelative("2026-07-19", "2026-07-16")).toEqual({ label: "in 3 days", tone: "ok" });
    expect(scheduleRelative("2026-07-14", "2026-07-16")).toEqual({ label: "2 days ago", tone: "overdue" });
    expect(scheduleRelative("2026-07-15", "2026-07-16")).toEqual({ label: "1 day ago", tone: "overdue" });
  });

  it("filterDeals honors a single tab", () => {
    const list = [
      deal({ id: "a", superStatus: JobSuperStatus.SUBMITTED, scheduledDate: "2026-07-13" }),
      deal({ id: "b", superStatus: JobSuperStatus.IN_PROGRESS }),
    ];
    expect(filterDeals(list, { tab: JobSuperStatus.SUBMITTED }, names).map((d) => d.id)).toEqual(["a"]);
    expect(filterDeals(list, { tab: "unscheduled" }, names).map((d) => d.id)).toEqual(["b"]);
  });
});
