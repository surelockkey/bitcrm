import { describe, it, expect } from "vitest";
import { JobSuperStatus, type Deal } from "@bitcrm/types";
import {
  WZ_EVENT_COLORS,
  clockLabel,
  hourLabel,
  layoutColumn,
  layoutLanes,
  localTodayISO,
  monthWeeks,
  ordinal,
  scheduleColor,
  scheduleItem,
  scheduleText,
  scheduleTitle,
  stepDate,
  timelineHourLabel,
  viewRange,
  weekOf,
} from "./calendar";

function deal(over: Partial<Deal> = {}): Deal {
  return {
    id: "d1",
    dealNumber: "1Z226I",
    contactId: "c1",
    clientType: "residential" as Deal["clientType"],
    serviceArea: "Platinum_TX",
    address: { street: "1526 Barbara Dr", city: "Lewisville", state: "TX", zip: "75067" },
    jobTypeId: "jt-door",
    superStatus: JobSuperStatus.SUBMITTED,
    assignedTechIds: [],
    assignedDispatcherId: "disp1",
    priority: "normal" as Deal["priority"],
    tagIds: [],
    status: "active" as Deal["status"],
    createdBy: "u1",
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-01T00:00:00Z",
    scheduledDate: "2026-10-09",
    scheduledTimeSlot: "09:00-11:00",
    ...over,
  };
}

describe("weekOf — Workiz weeks run Sunday to Saturday", () => {
  it("gives the Sun..Sat week around a Friday", () => {
    expect(weekOf("2026-10-09")).toEqual([
      "2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10",
    ]);
  });
  it("starts the week on the Sunday itself", () => {
    expect(weekOf("2026-10-04")[0]).toBe("2026-10-04");
  });
  it("ends the week on the Saturday itself", () => {
    expect(weekOf("2026-10-10")[6]).toBe("2026-10-10");
  });
  it("crosses a month boundary", () => {
    expect(weekOf("2026-10-01")).toEqual([
      "2026-09-27", "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03",
    ]);
  });
});

describe("monthWeeks — the month grid", () => {
  it("covers October 2026 in five Sunday-first rows (27 Sep … 31 Oct)", () => {
    const rows = monthWeeks("2026-10-09");
    expect(rows).toHaveLength(5);
    expect(rows[0][0]).toBe("2026-09-27");
    expect(rows[4][6]).toBe("2026-10-31");
  });
  it("needs only four rows for a February that starts on a Sunday", () => {
    const rows = monthWeeks("2026-02-14");
    expect(rows).toHaveLength(4);
    expect(rows[0][0]).toBe("2026-02-01");
    expect(rows[3][6]).toBe("2026-02-28");
  });
});

describe("viewRange — the days a view asks the server for", () => {
  it("a day for Day and Timeline", () => {
    expect(viewRange("day", "2026-10-09")).toEqual({ from: "2026-10-09", to: "2026-10-09" });
    expect(viewRange("timeline", "2026-10-09")).toEqual({ from: "2026-10-09", to: "2026-10-09" });
  });
  it("Sunday to Saturday for Week and Timeline Week", () => {
    expect(viewRange("week", "2026-10-09")).toEqual({ from: "2026-10-04", to: "2026-10-10" });
    expect(viewRange("timeline_week", "2026-10-09")).toEqual({ from: "2026-10-04", to: "2026-10-10" });
  });
  it("the calendar month for Month (as Workiz asks: 1.10.26_31.10.26)", () => {
    expect(viewRange("month", "2026-10-09")).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(viewRange("month", "2026-02-14")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
  });
});

describe("stepDate — ‹ and ›", () => {
  it("moves a day in Day and Timeline", () => {
    expect(stepDate("day", "2026-10-09", 1)).toBe("2026-10-10");
    expect(stepDate("timeline", "2026-10-01", -1)).toBe("2026-09-30");
  });
  it("moves a week in Week and Timeline Week", () => {
    expect(stepDate("week", "2026-10-09", 1)).toBe("2026-10-16");
    expect(stepDate("timeline_week", "2026-10-09", -1)).toBe("2026-10-02");
  });
  it("moves a month in Month, keeping the day where the month has it", () => {
    expect(stepDate("month", "2026-10-09", 1)).toBe("2026-11-09");
    expect(stepDate("month", "2026-10-31", 1)).toBe("2026-11-30");
    expect(stepDate("month", "2026-01-31", -1)).toBe("2025-12-31");
  });
});

describe("scheduleTitle — the words beside the arrows", () => {
  it("is the month for the calendar views", () => {
    expect(scheduleTitle("day", "2026-10-09")).toBe("October 2026");
    expect(scheduleTitle("week", "2026-10-09")).toBe("October 2026");
    expect(scheduleTitle("month", "2026-10-09")).toBe("October 2026");
    expect(scheduleTitle("timeline_week", "2026-10-09")).toBe("October 2026");
  });
  it("is the whole day for Timeline", () => {
    expect(scheduleTitle("timeline", "2026-10-09")).toBe("Fri, October 9th, 2026");
    expect(scheduleTitle("timeline", "2026-10-01")).toBe("Thu, October 1st, 2026");
  });
  it("ordinals", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 31].map(ordinal)).toEqual([
      "1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd", "31st",
    ]);
  });
});

describe("hour and clock labels", () => {
  it("hourLabel: the gutter's big hour and small AM/PM", () => {
    expect(hourLabel(0)).toEqual({ h: "12", m: "AM" });
    expect(hourLabel(7)).toEqual({ h: "7", m: "AM" });
    expect(hourLabel(12)).toEqual({ h: "12", m: "PM" });
    expect(hourLabel(13)).toEqual({ h: "1", m: "PM" });
  });
  it("timelineHourLabel: two-digit hours", () => {
    expect(timelineHourLabel(0)).toBe("12 AM");
    expect(timelineHourLabel(1)).toBe("01 AM");
    expect(timelineHourLabel(12)).toBe("12 PM");
    expect(timelineHourLabel(13)).toBe("01 PM");
  });
  it("clockLabel: the month view's start time", () => {
    expect(clockLabel(450)).toBe("7:30 AM");
    expect(clockLabel(0)).toBe("12:00 AM");
    expect(clockLabel(780)).toBe("1:00 PM");
    expect(clockLabel(735)).toBe("12:15 PM");
  });
});

describe("localTodayISO", () => {
  it("is the browser's own date, as Workiz's calendar uses", () => {
    expect(localTodayISO(new Date(2026, 9, 9, 1, 30))).toBe("2026-10-09");
    expect(localTodayISO(new Date(2026, 0, 2, 23, 59))).toBe("2026-01-02");
  });
});

describe("scheduleItem — a job as the calendar places it", () => {
  it("a timed one-day job sits in the time grid", () => {
    expect(scheduleItem(deal())).toMatchObject({
      startDate: "2026-10-09", endDate: "2026-10-09", startMin: 540, endMin: 660, bar: false,
    });
  });
  it("an all-day job is a bar", () => {
    expect(scheduleItem(deal({ allDay: true, scheduledTimeSlot: undefined }))).toMatchObject({ bar: true, startMin: 0, endMin: 1440 });
  });
  it("a dated job without times is a bar", () => {
    expect(scheduleItem(deal({ scheduledTimeSlot: undefined }))).toMatchObject({ bar: true });
  });
  it("a job over several days is a bar from its start day to its end day", () => {
    expect(
      scheduleItem(deal({ scheduledDate: "2026-10-12", scheduledEndDate: "2026-10-14", scheduledTimeSlot: "12:15-14:15" })),
    ).toMatchObject({ bar: true, startDate: "2026-10-12", endDate: "2026-10-14", startMin: 735, endMin: 855 });
  });
  it("an undated job is not on the calendar", () => {
    expect(scheduleItem(deal({ scheduledDate: undefined, scheduledTimeSlot: undefined }))).toBeNull();
  });
  it("a zero-length slot keeps its start", () => {
    expect(scheduleItem(deal({ scheduledTimeSlot: "16:30-16:30" }))).toMatchObject({ startMin: 990, endMin: 990, bar: false });
  });
});

describe("layoutColumn — overlapping jobs share a day column (dhtmlx)", () => {
  const it3 = (id: string, s: number, e: number) => ({ id, startMin: s, endMin: e });
  it("gives a lone job the whole column", () => {
    expect(layoutColumn([it3("a", 540, 600)]).get("a")).toEqual({ col: 0, cols: 1 });
  });
  it("splits two overlapping jobs in two", () => {
    const l = layoutColumn([it3("a", 540, 660), it3("b", 600, 720)]);
    expect(l.get("a")).toEqual({ col: 0, cols: 2 });
    expect(l.get("b")).toEqual({ col: 1, cols: 2 });
  });
  it("reuses a freed column inside a chain, and the chain shares one width", () => {
    const l = layoutColumn([it3("a", 540, 660), it3("b", 600, 720), it3("c", 690, 780)]);
    expect(l.get("a")).toEqual({ col: 0, cols: 2 });
    expect(l.get("b")).toEqual({ col: 1, cols: 2 });
    expect(l.get("c")).toEqual({ col: 0, cols: 2 });
  });
  it("starts afresh after the chain ends", () => {
    const l = layoutColumn([it3("a", 540, 660), it3("b", 600, 720), it3("d", 800, 860)]);
    expect(l.get("d")).toEqual({ col: 0, cols: 1 });
  });
  it("back-to-back jobs do not overlap", () => {
    const l = layoutColumn([it3("a", 540, 600), it3("b", 600, 660)]);
    expect(l.get("a")).toEqual({ col: 0, cols: 1 });
    expect(l.get("b")).toEqual({ col: 0, cols: 1 });
  });
  it("a zero-length job still takes its place", () => {
    const l = layoutColumn([it3("a", 990, 990), it3("b", 990, 1050)]);
    expect(l.get("a")?.cols).toBe(2);
  });
});

describe("layoutLanes — bars stacked into rows (multi-day strip, timeline)", () => {
  it("puts non-overlapping bars on the first lane", () => {
    const { lanes, count } = layoutLanes([
      { id: "a", start: 0, end: 2 },
      { id: "b", start: 2, end: 4 },
    ]);
    expect(lanes.get("a")).toBe(0);
    expect(lanes.get("b")).toBe(0);
    expect(count).toBe(1);
  });
  it("stacks overlapping bars", () => {
    const { lanes, count } = layoutLanes([
      { id: "a", start: 0, end: 3 },
      { id: "b", start: 1, end: 2 },
      { id: "c", start: 2, end: 5 },
    ]);
    expect(lanes.get("a")).toBe(0);
    expect(lanes.get("b")).toBe(1);
    expect(lanes.get("c")).toBe(1);
    expect(count).toBe(2);
  });
  it("counts nothing for no bars", () => {
    expect(layoutLanes([]).count).toBe(0);
  });
});

describe("scheduleText — this account's Workiz template", () => {
  it("is job id, job type, city, address and technicians", () => {
    expect(scheduleText(deal(), { jobType: "(A-1) Door Service", techs: ["(2) TX - DAVID SZENDER"] })).toBe(
      "1Z226I\n(A-1) Door Service,\nLewisville , 1526 Barbara Dr, Lewisville, TX 75067 \n(2) TX - DAVID SZENDER ",
    );
  });
  it("lists a crew comma-separated and says Unassigned for none", () => {
    expect(scheduleText(deal(), { jobType: "Call Back", techs: ["A", "B"] })).toMatch(/\nA,B $/);
    expect(scheduleText(deal(), { jobType: "Call Back", techs: [] })).toMatch(/\nUnassigned $/);
  });
  it("says N/A for a job without a type", () => {
    expect(scheduleText(deal(), { jobType: "", techs: [] })).toMatch(/^1Z226I\nN\/A,\n/);
  });
});

describe("scheduleColor — jobs coloured by service area (Workiz 'Color Job By: Service Area')", () => {
  it("is one of Workiz's event colours and the same for the same area", () => {
    const c = scheduleColor("Platinum_TX");
    expect(WZ_EVENT_COLORS).toContain(c);
    expect(scheduleColor("Platinum_TX")).toBe(c);
  });
  it("gives a job outside every area the first colour", () => {
    expect(scheduleColor("")).toBe(WZ_EVENT_COLORS[0]);
  });
  it("uses the area's own stored colour (Workiz's color_class) when it has one", () => {
    expect(scheduleColor("Platinum_TX", "#b8860b")).toBe("#b8860b");
    expect(scheduleColor("Platinum_CT", "#7FFFD4")).toBe("#7fffd4");
  });
  it("falls back to the name's pick when the stored colour is missing or not #rrggbb", () => {
    expect(scheduleColor("Platinum_TX", undefined)).toBe(scheduleColor("Platinum_TX"));
    expect(scheduleColor("Platinum_TX", "bgc16")).toBe(scheduleColor("Platinum_TX"));
  });
});
