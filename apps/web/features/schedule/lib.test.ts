import { describe, it, expect } from "vitest";
import {
  CalendarEventType,
  type CalendarEvent,
  type Deal,
  type TechnicianProfile,
  type User,
} from "@bitcrm/types";
import {
  parseSlot,
  slotMinutes,
  slotsOverlap,
  outOfHoursRanges,
  dealConflicts,
  filterTechnicians,
} from "./lib";

function deal(over: Partial<Deal>): Deal {
  return {
    id: "d1",
    dealNumber: "1",
    contactId: "c1",
    clientType: "residential" as Deal["clientType"],
    serviceArea: "TX",
    address: { street: "1 Main", city: "Austin", state: "TX", zip: "78701" },
    jobTypeId: "jt-lockout",
    superStatus: "in_progress" as Deal["superStatus"],
    assignedTechIds: [],
    assignedDispatcherId: "disp1",
    priority: "normal" as Deal["priority"],
    tagIds: [],
    status: "open" as Deal["status"],
    createdBy: "u1",
    createdAt: "2026-07-24T00:00:00Z",
    updatedAt: "2026-07-24T00:00:00Z",
    scheduledDate: "2026-07-24",
    scheduledTimeSlot: "09:00-11:00",
    ...over,
  };
}

function calEvent(over: Partial<CalendarEvent>): CalendarEvent {
  return {
    id: "e1",
    technicianId: "tech-1",
    type: CalendarEventType.LUNCH,
    title: "Lunch",
    startDate: "2026-07-24",
    endDate: "2026-07-24",
    allDay: false,
    timeSlot: "12:00-13:00",
    createdBy: "mgr-1",
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-01T00:00:00Z",
    ...over,
  };
}

describe("slot parsing + overlap", () => {
  it("parses a valid slot to minutes", () => {
    expect(parseSlot("09:30-11:00")).toEqual({ start: 570, end: 660 });
  });
  it("returns null for malformed slots", () => {
    expect(parseSlot("9-11")).toBeNull();
    expect(parseSlot(undefined)).toBeNull();
  });
  it("computes duration", () => {
    expect(slotMinutes("09:00-11:30")).toBe(150);
  });
  it("treats back-to-back slots as non-overlapping (half-open)", () => {
    expect(slotsOverlap("09:00-12:00", "12:00-15:00")).toBe(false);
  });
  it("detects a straddling overlap", () => {
    expect(slotsOverlap("11:00-13:00", "12:00-15:00")).toBe(true);
  });
});

describe("outOfHoursRanges — a technician's hours off on the Timeline", () => {
  const wh = { workingDays: [1, 2, 3, 4, 5], workStart: "08:00", workEnd: "17:00" };
  it("is the whole day on a day off", () => {
    expect(outOfHoursRanges(wh, "2026-07-26")).toEqual([[0, 1440]]); // Sunday
  });
  it("is before the start and after the end on a working day", () => {
    expect(outOfHoursRanges(wh, "2026-07-24")).toEqual([[0, 480], [1020, 1440]]); // Friday
  });
  it("is nothing when working hours are unset (opt-in)", () => {
    expect(outOfHoursRanges({}, "2026-07-24")).toEqual([]);
  });
});

describe("filterTechnicians", () => {
  const prof = (userId: string, status: TechnicianProfile["status"]): TechnicianProfile =>
    ({
      userId,
      callMaskingEnabled: false,
      gpsTrackingEnabled: false,
      mobileAppInstalled: false,
      status,
      createdAt: "",
      updatedAt: "",
    }) as TechnicianProfile;

  const users = new Map<string, User>([
    ["t1", { id: "t1", firstName: "Sam", lastName: "Ochoa", email: "s@x", department: "East" } as User],
    ["t2", { id: "t2", firstName: "Dana", lastName: "Reeves", email: "d@x", department: "West" } as User],
    ["t3", { id: "t3", firstName: "Lee", lastName: "Park", email: "l@x", department: "East" } as User],
  ]);
  const profiles = [prof("t1", "active"), prof("t2", "active"), prof("t3", "inactive")];

  it("keeps only active technicians when activeOnly is set", () => {
    const ids = filterTechnicians(profiles, users, { activeOnly: true }).map((p) => p.userId);
    expect(ids).toEqual(["t1", "t2"]);
  });

  it("returns all statuses when activeOnly is false", () => {
    expect(filterTechnicians(profiles, users, { activeOnly: false })).toHaveLength(3);
  });

  it("filters by department", () => {
    const ids = filterTechnicians(profiles, users, { activeOnly: false, department: "East" }).map((p) => p.userId);
    expect(ids).toEqual(["t1", "t3"]);
  });

  it("filters by a case-insensitive name query", () => {
    const ids = filterTechnicians(profiles, users, { activeOnly: false, query: "ree" }).map((p) => p.userId);
    expect(ids).toEqual(["t2"]);
  });

  it("drops someone switched off the field team, and keeps everyone else", () => {
    // The flag lives on the user record. A profile still exists for them —
    // their address and hours are theirs — but a column for someone who no
    // longer goes out on jobs is a column nothing can be dragged into.
    const withFlags = new Map<string, User>([
      ["t1", { ...users.get("t1")!, fieldTeamMember: false }],
      ["t2", { ...users.get("t2")!, fieldTeamMember: true }],
      ["t3", users.get("t3")!],
    ]);
    const ids = filterTechnicians(profiles, withFlags, { activeOnly: false }).map((p) => p.userId);
    expect(ids).toEqual(["t2", "t3"]);
  });

  it("combines filters", () => {
    const ids = filterTechnicians(profiles, users, { activeOnly: true, department: "East", query: "sam" }).map((p) => p.userId);
    expect(ids).toEqual(["t1"]);
  });
});

describe("dealConflicts", () => {
  const wh = { workingDays: [1, 2, 3, 4, 5], workStart: "08:00", workEnd: "17:00" };
  it("flags a double-booking against another job the same day", () => {
    const d = deal({ id: "a", scheduledTimeSlot: "09:00-11:00" });
    const other = deal({ id: "b", scheduledTimeSlot: "10:00-12:00" });
    expect(dealConflicts(d, [other], [], wh)).toContain("double_booked");
  });
  it("flags an overlap with a time-off event", () => {
    const d = deal({ id: "a", scheduledTimeSlot: "12:30-13:30" });
    expect(dealConflicts(d, [], [calEvent({})], wh)).toContain("time_off");
  });
  it("flags an all-day time-off for any slot that day", () => {
    const d = deal({ id: "a", scheduledTimeSlot: "09:00-10:00" });
    const off = calEvent({ allDay: true, timeSlot: undefined, type: CalendarEventType.TIME_OFF });
    expect(dealConflicts(d, [], [off], wh)).toContain("time_off");
  });
  it("flags out-of-hours work", () => {
    const d = deal({ id: "a", scheduledTimeSlot: "18:00-19:00" });
    expect(dealConflicts(d, [], [], wh)).toContain("out_of_hours");
  });
  it("returns no conflicts for a clean in-hours slot", () => {
    const d = deal({ id: "a", scheduledTimeSlot: "09:00-10:00" });
    expect(dealConflicts(d, [], [], wh)).toEqual([]);
  });
});
