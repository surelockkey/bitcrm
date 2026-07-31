import { describe, it, expect } from "vitest";
import { JobSuperStatus, type DealSubStatus } from "@bitcrm/types";
import { jobStatusName, jobStatusMap, activeJobStatuses, groupJobStatuses } from "./lib";

const st = (over: Partial<DealSubStatus>): DealSubStatus => ({
  id: "s-1",
  name: "Will Call Back",
  group: JobSuperStatus.PENDING,
  color: "red",
  priority: 0,
  active: true,
  createdBy: "admin",
  createdAt: "",
  updatedAt: "",
  ...over,
});

describe("jobStatusName", () => {
  const catalog = [
    st({ id: "s-1", name: "Will Call Back" }),
    st({ id: "s-2", name: "Job Done", group: JobSuperStatus.IN_PROGRESS }),
  ];

  it("resolves an id to its name", () => {
    expect(jobStatusName("s-2", catalog)).toBe("Job Done");
  });
  it("falls back to the raw id for an unknown status", () => {
    expect(jobStatusName("s-x", catalog)).toBe("s-x");
  });
  it("renders a dash for a missing id", () => {
    expect(jobStatusName(undefined, catalog)).toBe("—");
  });
  it("builds an id → status map", () => {
    expect(jobStatusMap(catalog).get("s-1")?.group).toBe(JobSuperStatus.PENDING);
  });
});

describe("activeJobStatuses", () => {
  it("drops archived statuses and sorts by priority desc then name", () => {
    const list = activeJobStatuses([
      st({ id: "a", name: "B", priority: 1 }),
      st({ id: "b", name: "A", priority: 5 }),
      st({ id: "c", name: "Z", priority: 5 }),
      st({ id: "d", name: "Old", active: false }),
    ]);
    expect(list.map((s) => s.id)).toEqual(["b", "c", "a"]);
  });
});

describe("groupJobStatuses", () => {
  const list = [
    st({ id: "p1", name: "Will Call Back", group: JobSuperStatus.PENDING, priority: 1 }),
    st({ id: "i1", name: "Job Done", group: JobSuperStatus.IN_PROGRESS, priority: 2 }),
    st({ id: "i2", name: "Job Accepted", group: JobSuperStatus.IN_PROGRESS, priority: 5 }),
    st({ id: "old", name: "Archived", group: JobSuperStatus.PENDING, active: false }),
  ];

  it("orders groups by pipeline order and nests sorted, active statuses", () => {
    const groups = groupJobStatuses(list, { activeOnly: true });
    // Only groups with active statuses, in pipeline order (In Progress before Pending).
    expect(groups.map((g) => g.group)).toEqual([
      JobSuperStatus.IN_PROGRESS,
      JobSuperStatus.PENDING,
    ]);
    expect(groups[0].label).toBe("In Progress");
    expect(groups[0].statuses.map((s) => s.id)).toEqual(["i2", "i1"]); // priority 5 before 2
    expect(groups[1].statuses.map((s) => s.id)).toEqual(["p1"]); // archived dropped
  });

  it("includeEmpty keeps every super-status even with no statuses", () => {
    const groups = groupJobStatuses([], { includeEmpty: true });
    expect(groups.map((g) => g.group)).toEqual([
      JobSuperStatus.SUBMITTED,
      JobSuperStatus.IN_PROGRESS,
      JobSuperStatus.DONE,
      JobSuperStatus.PENDING,
      JobSuperStatus.DONE_PENDING_APPROVAL,
      JobSuperStatus.CANCELED,
    ]);
    expect(groups.every((g) => g.statuses.length === 0)).toBe(true);
  });

  it("without activeOnly includes archived statuses (for settings)", () => {
    const groups = groupJobStatuses(list, { includeEmpty: true });
    const pending = groups.find((g) => g.group === JobSuperStatus.PENDING)!;
    expect(pending.statuses.map((s) => s.name).sort()).toEqual(["Archived", "Will Call Back"]);
  });
});
