import { describe, it, expect } from "vitest";
import {
  CalendarEventType,
  type CalendarEvent,
  type Deal,
  type TechnicianProfile,
  type User,
} from "@bitcrm/types";
import {
  weekDays,
  parseSlot,
  slotMinutes,
  slotsOverlap,
  blockGeometry,
  layoutDayColumn,
  outOfHoursBands,
  dealConflicts,
  computeDayWindow,
  filterTechnicians,
  type Grid,
} from "./lib";

const grid: Grid = { startHour: 7, endHour: 19, hourPx: 56, minBlockPx: 24 };

function deal(over: Partial<Deal>): Deal {
  return {
    id: "d1",
    dealNumber: 1,
    contactId: "c1",
    clientType: "residential" as Deal["clientType"],
    serviceArea: "TX",
    address: { street: "1 Main", city: "Austin", state: "TX", zip: "78701" },
    jobType: "lockout",
    stage: "assigned" as Deal["stage"],
    assignedDispatcherId: "disp1",
    priority: "normal" as Deal["priority"],
    tags: [],
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

describe("weekDays", () => {
  it("returns Mon..Sun for a mid-week anchor", () => {
    // 2026-07-24 is a Friday
    expect(weekDays("2026-07-24")).toEqual([
      "2026-07-20", "2026-07-21", "2026-07-22", "2026-07-23",
      "2026-07-24", "2026-07-25", "2026-07-26",
    ]);
  });
  it("handles a Sunday anchor (belongs to the week ending that day)", () => {
    // 2026-07-26 is a Sunday
    expect(weekDays("2026-07-26")[0]).toBe("2026-07-20");
    expect(weekDays("2026-07-26")[6]).toBe("2026-07-26");
  });
  it("crosses a month boundary safely", () => {
    // 2026-08-01 is a Saturday → week Mon 2026-07-27 .. Sun 2026-08-02
    expect(weekDays("2026-08-01")).toEqual([
      "2026-07-27", "2026-07-28", "2026-07-29", "2026-07-30",
      "2026-07-31", "2026-08-01", "2026-08-02",
    ]);
  });
});

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

describe("blockGeometry", () => {
  it("positions a block by its start and duration", () => {
    const g = blockGeometry("09:00-11:00", grid);
    // 9:00 is 2h after grid start (7:00) → 112px; 2h tall → 112px
    expect(g).toEqual({ topPx: 112, heightPx: 112 });
  });
  it("clamps very short blocks to a minimum height", () => {
    const g = blockGeometry("09:00-09:10", grid);
    expect(g.heightPx).toBe(grid.minBlockPx);
  });
});

describe("layoutDayColumn", () => {
  it("lays out non-overlapping jobs at full width with no overflow", () => {
    const jobs = [deal({ id: "a", scheduledTimeSlot: "08:00-09:00" }), deal({ id: "b", scheduledTimeSlot: "10:00-11:00" })];
    const laid = layoutDayColumn(jobs, grid);
    expect(laid.blocks.map((b) => b.deal.id)).toEqual(["a", "b"]);
    expect(laid.blocks.every((b) => b.overflowCount === 0)).toBe(true);
  });
  it("collapses overlapping jobs into a +N pill on the earliest block", () => {
    const jobs = [
      deal({ id: "a", scheduledTimeSlot: "09:00-11:00" }),
      deal({ id: "b", scheduledTimeSlot: "09:30-10:30" }),
      deal({ id: "c", scheduledTimeSlot: "10:00-12:00" }),
    ];
    const laid = layoutDayColumn(jobs, grid);
    // Only the earliest of the overlapping cluster is rendered, carrying +2.
    expect(laid.blocks).toHaveLength(1);
    expect(laid.blocks[0].deal.id).toBe("a");
    expect(laid.blocks[0].overflowCount).toBe(2);
    expect(laid.hidden.map((d) => d.id)).toEqual(["b", "c"]);
  });
  it("puts unscheduled (no slot) jobs in a separate tray, not the grid", () => {
    const jobs = [deal({ id: "a", scheduledTimeSlot: undefined })];
    const laid = layoutDayColumn(jobs, grid);
    expect(laid.blocks).toHaveLength(0);
    expect(laid.unscheduled.map((d) => d.id)).toEqual(["a"]);
  });
});

describe("outOfHoursBands", () => {
  it("dims the whole column on a non-working day", () => {
    const bands = outOfHoursBands({ workingDays: [1, 2, 3, 4, 5], workStart: "08:00", workEnd: "17:00" }, "2026-07-26", grid); // Sunday
    expect(bands).toEqual([{ topPx: 0, heightPx: (grid.endHour - grid.startHour) * grid.hourPx }]);
  });
  it("dims before-start and after-end on a working day", () => {
    const bands = outOfHoursBands({ workingDays: [1, 2, 3, 4, 5], workStart: "08:00", workEnd: "17:00" }, "2026-07-24", grid); // Friday
    // before: 7:00-8:00 → top 0, height 56; after: 17:00-19:00 → top 560, height 112
    expect(bands).toContainEqual({ topPx: 0, heightPx: 56 });
    expect(bands).toContainEqual({ topPx: 560, heightPx: 112 });
  });
  it("returns no bands when working hours are unset (opt-in)", () => {
    expect(outOfHoursBands({}, "2026-07-24", grid)).toEqual([]);
  });
});

describe("computeDayWindow", () => {
  const wh = (over?: Partial<TechnicianProfile>): TechnicianProfile =>
    ({
      userId: "t1",
      callMaskingEnabled: false,
      gpsTrackingEnabled: false,
      mobileAppInstalled: false,
      status: "active",
      createdAt: "",
      updatedAt: "",
      ...over,
    }) as TechnicianProfile;

  it("defaults to 7..19 when there are no jobs or working hours", () => {
    expect(computeDayWindow([], new Map(), "2026-07-24")).toEqual({ startHour: 7, endHour: 19 });
  });

  it("expands down to fit an early job", () => {
    const jobs = [deal({ scheduledTimeSlot: "05:30-06:30" })];
    expect(computeDayWindow(jobs, new Map(), "2026-07-24").startHour).toBe(5);
  });

  it("expands up to fit a late job", () => {
    const jobs = [deal({ scheduledTimeSlot: "20:00-21:30" })];
    expect(computeDayWindow(jobs, new Map(), "2026-07-24").endHour).toBe(22);
  });

  it("expands to fit working hours that run past the default", () => {
    const profiles = new Map([["t1", wh({ workStart: "06:00", workEnd: "22:00" })]]);
    const w = computeDayWindow([], profiles, "2026-07-24");
    expect(w).toEqual({ startHour: 6, endHour: 22 });
  });

  it("ignores jobs on other days", () => {
    const jobs = [deal({ scheduledDate: "2026-07-25", scheduledTimeSlot: "05:00-06:00" })];
    expect(computeDayWindow(jobs, new Map(), "2026-07-24")).toEqual({ startHour: 7, endHour: 19 });
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
