import { describe, it, expect } from "vitest";
import { JobSuperStatus, type Deal } from "@bitcrm/types";
import { formatSlot, moveBody, nextTechIds, resolveDrop, scheduleBody, snapMinutes } from "./reschedule";

function deal(over: Partial<Deal> = {}): Deal {
  return {
    id: "d1",
    dealNumber: "AB12CD",
    contactId: "c1",
    clientType: "residential" as Deal["clientType"],
    serviceArea: "North",
    address: { street: "1 Elm", city: "Town", state: "CT", zip: "06001" },
    jobTypeId: "jt",
    superStatus: JobSuperStatus.SUBMITTED,
    assignedTechIds: ["t1", "t2"],
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

describe("snapMinutes — the grid's 15-minute steps", () => {
  it("rounds to the nearest quarter hour", () => {
    expect(snapMinutes(547)).toBe(540);
    expect(snapMinutes(553)).toBe(555);
  });
  it("stays inside the day", () => {
    expect(snapMinutes(-30)).toBe(0);
    expect(snapMinutes(1500)).toBe(1425);
  });
});

describe("formatSlot", () => {
  it("prints HH:MM-HH:MM", () => {
    expect(formatSlot(540, 615)).toBe("09:00-10:15");
  });
  it("never runs past the end of the day", () => {
    expect(formatSlot(1410, 1500)).toBe("23:30-23:59");
  });
});

describe("nextTechIds — who is on the job after a drop on another row", () => {
  it("swaps the technician dragged from for the one dropped on, keeping the crew", () => {
    expect(nextTechIds(["t1", "t2"], "t1", "t3")).toEqual(["t3", "t2"]);
  });
  it("adds the technician when the job came from the Unassigned row", () => {
    expect(nextTechIds([], null, "t3")).toEqual(["t3"]);
  });
  it("takes the technician off when the job is dropped on Unassigned", () => {
    expect(nextTechIds(["t1", "t2"], "t1", null)).toEqual(["t2"]);
  });
  it("does not list a technician twice", () => {
    expect(nextTechIds(["t1", "t2"], "t1", "t2")).toEqual(["t2"]);
  });
});

describe("moveBody — the update a drop sends", () => {
  it("moves a timed job to a new day and start, keeping its length", () => {
    expect(moveBody(deal(), { date: "2026-10-10", startMin: 600 })).toEqual({
      scheduledDate: "2026-10-10",
      scheduledTimeSlot: "10:00-12:00",
    });
  });
  it("keeps the times when only the day changes (month, timeline week)", () => {
    expect(moveBody(deal(), { date: "2026-10-12" })).toEqual({
      scheduledDate: "2026-10-12",
      scheduledTimeSlot: "09:00-11:00",
    });
  });
  it("moves the end day with a job over several days", () => {
    expect(
      moveBody(deal({ scheduledDate: "2026-10-12", scheduledEndDate: "2026-10-14", scheduledTimeSlot: "12:15-14:15" }), {
        date: "2026-10-13",
      }),
    ).toEqual({ scheduledDate: "2026-10-13", scheduledEndDate: "2026-10-15", scheduledTimeSlot: "12:15-14:15" });
  });
  it("moves an all-day job by its days only", () => {
    expect(moveBody(deal({ allDay: true, scheduledTimeSlot: undefined }), { date: "2026-10-11", startMin: 600 })).toEqual({
      scheduledDate: "2026-10-11",
    });
  });
});

describe("scheduleBody — an unscheduled job dropped on the calendar", () => {
  it("gets the day and an hour from where it was dropped", () => {
    expect(scheduleBody("2026-10-09", 870)).toEqual({ scheduledDate: "2026-10-09", scheduledTimeSlot: "14:30-15:30" });
  });
  it("gets the day only when dropped on a day (month, timeline week): 9 to 10", () => {
    expect(scheduleBody("2026-10-09")).toEqual({ scheduledDate: "2026-10-09", scheduledTimeSlot: "09:00-10:00" });
  });
  it("is as long as its job type's duration says (Workiz), still inside the day", () => {
    expect(scheduleBody("2026-10-09", 870, 120)).toEqual({ scheduledDate: "2026-10-09", scheduledTimeSlot: "14:30-16:30" });
    expect(scheduleBody("2026-10-09", 9 * 60, 3000)).toEqual({ scheduledDate: "2026-10-09", scheduledTimeSlot: "09:00-23:59" });
  });
});

describe("resolveDrop — where a dragged job lands", () => {
  const d = deal();
  const rect = { top: 100, left: 300 };
  it("a box in Day/Week moves by the hours it was dragged and to the column it was dropped on", () => {
    expect(
      resolveDrop({ kind: "time", deal: d, startMin: 540 }, { kind: "day", date: "2026-10-10" }, { x: 0, y: 88 }, null, rect),
    ).toEqual({ date: "2026-10-10", startMin: 600 });
  });
  it("snaps a box to the quarter hour", () => {
    expect(
      resolveDrop({ kind: "time", deal: d, startMin: 540 }, { kind: "day", date: "2026-10-09" }, { x: 0, y: 30 }, null, rect),
    ).toEqual({ date: "2026-10-09", startMin: 555 });
  });
  it("nothing happens when a box is put back where it was, or dropped off the grid", () => {
    expect(
      resolveDrop({ kind: "time", deal: d, startMin: 540 }, { kind: "day", date: "2026-10-09" }, { x: 0, y: 3 }, null, rect),
    ).toBeNull();
    expect(resolveDrop({ kind: "time", deal: d, startMin: 540 }, null, { x: 0, y: 88 }, null, rect)).toBeNull();
  });
  it("a bar in the Week strip moves by whole days", () => {
    expect(resolveDrop({ kind: "days", deal: d, dayPx: 190 }, null, { x: 200, y: 4 }, null, rect)).toEqual({
      date: "2026-10-10",
    });
  });
  it("a Timeline bar moves along the hours and onto another technician's row", () => {
    expect(
      resolveDrop(
        { kind: "tl-time", deal: d, startMin: 540, fromTechId: "t1" },
        { kind: "row", axis: "time", techId: "t3", date: "2026-10-09" },
        { x: 70, y: 75 },
        null,
        rect,
      ),
    ).toEqual({ date: "2026-10-09", startMin: 600, techId: "t3" });
  });
  it("a Timeline bar dropped on its own row at the same time changes nothing", () => {
    expect(
      resolveDrop(
        { kind: "tl-time", deal: d, startMin: 540, fromTechId: "t1" },
        { kind: "row", axis: "time", techId: "t1", date: "2026-10-09" },
        { x: 4, y: 2 },
        null,
        rect,
      ),
    ).toBeNull();
  });
  it("a Timeline Week bar moves by days and rows", () => {
    expect(
      resolveDrop(
        { kind: "tl-days", deal: d, dayPx: 176, fromTechId: null },
        { kind: "row", axis: "days", techId: "t2", days: [], dayPx: 176 },
        { x: -176, y: 80 },
        null,
        rect,
      ),
    ).toEqual({ date: "2026-10-08", techId: "t2" });
  });
  it("a Month line moves to the day it is dropped on", () => {
    expect(resolveDrop({ kind: "month", deal: d }, { kind: "cell", date: "2026-10-20" }, { x: 1, y: 1 }, null, rect)).toEqual({
      date: "2026-10-20",
    });
  });
  it("an unscheduled card lands where the pointer let go", () => {
    const card = { kind: "card" as const, deal: deal({ scheduledDate: undefined, scheduledTimeSlot: undefined }) };
    expect(
      resolveDrop(card, { kind: "day", date: "2026-10-09" }, { x: 0, y: 0 }, { x: 320, y: 100 + 88 * 14 + 44 }, rect),
    ).toEqual({ date: "2026-10-09", startMin: 870 });
    expect(
      resolveDrop(
        card,
        { kind: "row", axis: "time", techId: "t1", date: "2026-10-09" },
        { x: 0, y: 0 },
        { x: 300 + 70 * 9, y: 120 },
        rect,
      ),
    ).toEqual({ date: "2026-10-09", startMin: 540, techId: "t1" });
    expect(
      resolveDrop(
        card,
        { kind: "row", axis: "days", techId: null, days: ["2026-10-04", "2026-10-05", "2026-10-06"], dayPx: 176 },
        { x: 0, y: 0 },
        { x: 300 + 176 * 2 + 10, y: 120 },
        rect,
      ),
    ).toEqual({ date: "2026-10-06", techId: null });
    expect(resolveDrop(card, { kind: "cell", date: "2026-10-22" }, { x: 0, y: 0 }, { x: 0, y: 0 }, rect)).toEqual({
      date: "2026-10-22",
    });
  });
});
