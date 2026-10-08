import { describe, it, expect } from "vitest";
import { JobSuperStatus, type Deal } from "@bitcrm/types";
import { applyScheduleFilter, pickedTechIds, SCHEDULE_STATUS_OPTIONS } from "./filters";

function deal(id: string, over: Partial<Deal> = {}): Deal {
  return {
    id,
    dealNumber: id.toUpperCase(),
    contactId: "c1",
    clientType: "residential" as Deal["clientType"],
    serviceArea: "North",
    address: { street: "1 Elm", city: "Town", state: "CT", zip: "06001" },
    jobTypeId: "jt-door",
    superStatus: JobSuperStatus.SUBMITTED,
    assignedTechIds: [],
    assignedDispatcherId: "u1",
    priority: "normal" as Deal["priority"],
    tagIds: [],
    status: "active" as Deal["status"],
    createdBy: "u1",
    createdAt: "",
    updatedAt: "",
    scheduledDate: "2026-10-09",
    scheduledTimeSlot: "09:00-11:00",
    ...over,
  };
}

const a = deal("a", { assignedTechIds: ["t1"], tagIds: ["vip"], serviceArea: "North" });
const b = deal("b", { assignedTechIds: ["t2"], jobTypeId: "jt-key", serviceArea: "South", superStatus: JobSuperStatus.DONE });
const c = deal("c", { superStatus: JobSuperStatus.CANCELED });

describe("applyScheduleFilter — Filter results over the calendar", () => {
  it("shows every job but the canceled ones with nothing picked", () => {
    expect(applyScheduleFilter([a, b, c], []).map((d) => d.id)).toEqual(["a", "b"]);
  });
  it("narrows to the jobs of the picked technicians (any of them)", () => {
    expect(applyScheduleFilter([a, b, c], [{ group: "team", value: "t1" }]).map((d) => d.id)).toEqual(["a"]);
    expect(
      applyScheduleFilter([a, b], [{ group: "team", value: "t1" }, { group: "team", value: "t2" }]).map((d) => d.id),
    ).toEqual(["a", "b"]);
  });
  it("ANDs the groups together", () => {
    expect(
      applyScheduleFilter([a, b], [{ group: "team", value: "t2" }, { group: "areas", value: "North" }]).map((d) => d.id),
    ).toEqual([]);
  });
  it("filters by tag, status, job type and service area", () => {
    expect(applyScheduleFilter([a, b], [{ group: "tags", value: "vip" }]).map((d) => d.id)).toEqual(["a"]);
    expect(applyScheduleFilter([a, b], [{ group: "status", value: JobSuperStatus.DONE }]).map((d) => d.id)).toEqual(["b"]);
    expect(applyScheduleFilter([a, b], [{ group: "job_type", value: "jt-key" }]).map((d) => d.id)).toEqual(["b"]);
    expect(applyScheduleFilter([a, b], [{ group: "areas", value: "South" }]).map((d) => d.id)).toEqual(["b"]);
  });
  it("shows canceled jobs when Canceled is picked under STATUS", () => {
    expect(
      applyScheduleFilter([a, b, c], [{ group: "status", value: JobSuperStatus.CANCELED }]).map((d) => d.id),
    ).toEqual(["c"]);
  });
});

describe("pickedTechIds", () => {
  it("is null with no technician picked (every row shows)", () => {
    expect(pickedTechIds([{ group: "tags", value: "vip" }])).toBeNull();
  });
  it("lists the picked technicians", () => {
    expect(pickedTechIds([{ group: "team", value: "t1" }, { group: "team", value: "t2" }])).toEqual(["t1", "t2"]);
  });
});

describe("SCHEDULE_STATUS_OPTIONS", () => {
  it("are Workiz's six, in its order and words", () => {
    expect(SCHEDULE_STATUS_OPTIONS.map((o) => o.label)).toEqual([
      "Submitted", "In progress", "Canceled", "Done", "Pending", "Done pending approval",
    ]);
  });
});
