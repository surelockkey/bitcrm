import { describe, it, expect } from "vitest";
import { CalendarEventType, JobSuperStatus, type CalendarEvent, type Deal } from "@bitcrm/types";
import { buildEntries } from "./entries";
import { WZ_DEFAULT_EVENT_COLOR, scheduleColor } from "./calendar";

function deal(id: string, over: Partial<Deal> = {}): Deal {
  return {
    id,
    dealNumber: id.toUpperCase(),
    contactId: "c1",
    clientType: "residential" as Deal["clientType"],
    serviceArea: "North",
    address: { street: "1 Elm St", city: "Town", state: "CT", zip: "06001" },
    jobTypeId: "jt-door",
    superStatus: JobSuperStatus.SUBMITTED,
    assignedTechIds: ["t1"],
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

const off = (over: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: "e1",
  technicianId: "t1",
  type: CalendarEventType.TIME_OFF,
  title: "Dentist",
  startDate: "2026-10-09",
  endDate: "2026-10-09",
  allDay: true,
  createdBy: "m",
  createdAt: "",
  updatedAt: "",
  ...over,
});

const ctx = {
  jobTypeName: (id: string) => (id === "jt-door" ? "(A-1) Door Service" : ""),
  techName: (id: string) => (id === "t1" ? "Sam Reyes" : id === "t2" ? "Nia Holt" : ""),
  profiles: new Map(),
};

describe("buildEntries — what the calendar draws", () => {
  it("words and colours a job the Workiz way", () => {
    const [e] = buildEntries([deal("ab12cd")], [], ctx);
    expect(e).toMatchObject({
      id: "ab12cd",
      kind: "job",
      title: "Job ID: AB12CD",
      text: "AB12CD\n(A-1) Door Service,\nTown , 1 Elm St, Town, CT 06001 \nSam Reyes ",
      color: scheduleColor("North"),
      done: false,
      bar: false,
      startMin: 540,
      endMin: 660,
      techIds: ["t1"],
    });
  });
  it("marks a Done job (striped)", () => {
    expect(buildEntries([deal("a", { superStatus: JobSuperStatus.DONE })], [], ctx)[0].done).toBe(true);
  });
  it("leaves an undated job off the calendar", () => {
    expect(buildEntries([deal("a", { scheduledDate: undefined })], [], ctx)).toEqual([]);
  });
  it("draws time off in the default colour on its technician's row", () => {
    const [e] = buildEntries([], [off()], ctx);
    expect(e).toMatchObject({
      id: "off:e1",
      kind: "off",
      text: "Time off: Dentist - Sam Reyes",
      color: WZ_DEFAULT_EVENT_COLOR,
      bar: true,
      techIds: ["t1"],
    });
  });
  it("places timed time off in the hours", () => {
    const [e] = buildEntries([], [off({ allDay: false, timeSlot: "12:00-13:00", type: CalendarEventType.LUNCH, title: "" })], ctx);
    expect(e).toMatchObject({ bar: false, startMin: 720, endMin: 780, text: "Lunch - Sam Reyes" });
  });
  it("flags a job that overlaps another of its technician's jobs", () => {
    const entries = buildEntries([deal("a"), deal("b", { scheduledTimeSlot: "10:00-12:00" })], [], ctx);
    expect(entries.every((e) => e.conflict)).toBe(true);
  });
  it("flags a job on a technician's time off", () => {
    const entries = buildEntries([deal("a")], [off()], ctx);
    expect(entries.find((e) => e.kind === "job")?.conflict).toBe(true);
  });
});
