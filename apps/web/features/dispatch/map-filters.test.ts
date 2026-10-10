import { describe, expect, it } from "vitest";
import { ClientType, DealPriority, DealStatus, JobSuperStatus, type Deal } from "@bitcrm/types";

import {
  EMPTY_MAP_FILTERS,
  MAP_CLOSED_STATUSES,
  MAP_STATUSES,
  UNASSIGNED,
  closedMapWindow,
  countMapFilters,
  mapFoundText,
  matchesMapFilters,
  sortByName,
  toggleValue,
} from "./map-filters";

function deal(over: Partial<Deal> = {}): Deal {
  return {
    id: "d1",
    dealNumber: "A4IC4E",
    contactId: "c1",
    clientType: ClientType.RESIDENTIAL,
    serviceArea: "SURE LOCK CT",
    address: { street: "1 Main", city: "New Haven", state: "CT", zip: "06511" },
    jobTypeId: "jt-1",
    superStatus: JobSuperStatus.SUBMITTED,
    assignedDispatcherId: "u1",
    priority: DealPriority.NORMAL,
    assignedTechIds: ["t1"],
    tagIds: [],
    status: DealStatus.ACTIVE,
    createdBy: "u1",
    createdAt: "",
    updatedAt: "",
    ...over,
  };
}

describe("matchesMapFilters", () => {
  it("lets everything through with nothing ticked", () => {
    expect(matchesMapFilters(deal(), EMPTY_MAP_FILTERS)).toBe(true);
  });

  it("Technician: a job any ticked tech is on", () => {
    const f = { ...EMPTY_MAP_FILTERS, techIds: ["t2"] };
    expect(matchesMapFilters(deal({ assignedTechIds: ["t1", "t2"] }), f)).toBe(true);
    expect(matchesMapFilters(deal({ assignedTechIds: ["t1"] }), f)).toBe(false);
  });

  it("Technician: 'Unassigned' is a job with nobody on it", () => {
    const f = { ...EMPTY_MAP_FILTERS, techIds: [UNASSIGNED] };
    expect(matchesMapFilters(deal({ assignedTechIds: [] }), f)).toBe(true);
    expect(matchesMapFilters(deal({ assignedTechIds: ["t1"] }), f)).toBe(false);
    // Together with a tech: either.
    const both = { ...EMPTY_MAP_FILTERS, techIds: [UNASSIGNED, "t1"] };
    expect(matchesMapFilters(deal({ assignedTechIds: ["t1"] }), both)).toBe(true);
    expect(matchesMapFilters(deal({ assignedTechIds: [] }), both)).toBe(true);
  });

  it("Service Area, Status and Job Type each narrow to what is ticked", () => {
    expect(matchesMapFilters(deal(), { ...EMPTY_MAP_FILTERS, areas: ["SURE LOCK TX"] })).toBe(false);
    expect(matchesMapFilters(deal(), { ...EMPTY_MAP_FILTERS, areas: ["SURE LOCK CT", "SURE LOCK TX"] })).toBe(true);
    expect(matchesMapFilters(deal(), { ...EMPTY_MAP_FILTERS, statuses: [JobSuperStatus.PENDING] })).toBe(false);
    expect(matchesMapFilters(deal(), { ...EMPTY_MAP_FILTERS, statuses: [JobSuperStatus.SUBMITTED] })).toBe(true);
    expect(matchesMapFilters(deal(), { ...EMPTY_MAP_FILTERS, jobTypeIds: ["jt-2"] })).toBe(false);
    expect(matchesMapFilters(deal(), { ...EMPTY_MAP_FILTERS, jobTypeIds: ["jt-1"] })).toBe(true);
  });

  it("all the sections at once must hold together", () => {
    const f = { ...EMPTY_MAP_FILTERS, techIds: ["t1"], areas: ["SURE LOCK CT"], statuses: [JobSuperStatus.PENDING] };
    expect(matchesMapFilters(deal(), f)).toBe(false);
    expect(matchesMapFilters(deal({ superStatus: JobSuperStatus.PENDING }), f)).toBe(true);
  });
});

describe("MAP_STATUSES", () => {
  // The Filters panel's Status section, in Workiz's order — open jobs only.
  it("is Workiz's four open statuses", () => {
    expect(MAP_STATUSES).toEqual([
      JobSuperStatus.SUBMITTED,
      JobSuperStatus.IN_PROGRESS,
      JobSuperStatus.PENDING,
      JobSuperStatus.DONE_PENDING_APPROVAL,
    ]);
  });
});

describe("Done / Canceled on the map (ours — Workiz's Map shows open jobs only)", () => {
  const ticked = (...statuses: JobSuperStatus[]) => ({ ...EMPTY_MAP_FILTERS, statuses });
  const week = { from: "2026-10-04", to: "2026-10-10" };

  it("are offered after Workiz's four", () => {
    expect(MAP_CLOSED_STATUSES).toEqual([JobSuperStatus.DONE, JobSuperStatus.CANCELED]);
  });

  it("are read only when ticked, and only for the date box's days", () => {
    expect(closedMapWindow(EMPTY_MAP_FILTERS, week)).toBeNull();
    expect(closedMapWindow(ticked(JobSuperStatus.SUBMITTED), week)).toBeNull();
    expect(closedMapWindow(ticked(JobSuperStatus.SUBMITTED, JobSuperStatus.DONE), week)).toEqual({
      ...week,
      statuses: [JobSuperStatus.DONE],
    });
    expect(closedMapWindow(ticked(JobSuperStatus.CANCELED, JobSuperStatus.DONE), week)).toEqual({
      ...week,
      statuses: [JobSuperStatus.DONE, JobSuperStatus.CANCELED],
    });
  });

  it("are never read for Any date — closed jobs of every date are far too many", () => {
    expect(closedMapWindow(ticked(JobSuperStatus.DONE), {})).toBeNull();
  });
});

describe("mapFoundText", () => {
  it("counts among the open jobs, as Workiz does", () => {
    expect(mapFoundText({ shown: 2, open: 3 })).toBe("Found 2 out of 3 open jobs");
  });

  it("with Done / Canceled read in, counts among every job held", () => {
    expect(mapFoundText({ shown: 5, open: 3, closed: 4 })).toBe("Found 5 out of 7 jobs");
  });

  it("says why no Done / Canceled show for Any date", () => {
    expect(mapFoundText({ shown: 0, open: 3, closedNeedDays: true })).toBe(
      "Found 0 out of 3 open jobs · pick Day, Week or Month for Done / Canceled",
    );
  });
});

describe("toggleValue / countMapFilters", () => {
  it("ticks and unticks", () => {
    expect(toggleValue(["a"], "b")).toEqual(["a", "b"]);
    expect(toggleValue(["a", "b"], "a")).toEqual(["b"]);
  });

  it("counts every tick", () => {
    expect(countMapFilters(EMPTY_MAP_FILTERS)).toBe(0);
    expect(countMapFilters({ techIds: ["a", UNASSIGNED], areas: ["x"], statuses: [], jobTypeIds: ["j"] })).toBe(4);
  });
});

describe("sortByName", () => {
  // Workiz lists the Technician section A→Z, ignoring case: "(1) …" before
  // "(2) …", "Albert IL" before "DIN LAVI ( D )" before "Jacob Test".
  it("sorts the way the Filters panel does", () => {
    const rows = ["Jacob Test", "(2) AL - Alvin Andrews", "DIN LAVI ( D )", "albert IL", "(1) Harry EM"].map((label) => ({ label }));
    expect(sortByName(rows).map((r) => r.label)).toEqual([
      "(1) Harry EM",
      "(2) AL - Alvin Andrews",
      "albert IL",
      "DIN LAVI ( D )",
      "Jacob Test",
    ]);
  });
});
