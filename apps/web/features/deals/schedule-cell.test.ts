import { describe, expect, it } from "vitest";
import { workizFromNow, workizScheduleCell, zonedInstant } from "./schedule-cell";

const ACCOUNT = "America/New_York";

describe("zonedInstant — a wall clock in a zone, as an instant", () => {
  it("reads the date and time in the zone given", () => {
    expect(zonedInstant("2026-10-08", "08:00", "America/Chicago").toISOString()).toBe("2026-10-08T13:00:00.000Z");
    expect(zonedInstant("2026-10-08", "09:00", "America/New_York").toISOString()).toBe("2026-10-08T13:00:00.000Z");
    expect(zonedInstant("2026-01-15", "09:00", "America/New_York").toISOString()).toBe("2026-01-15T14:00:00.000Z");
  });
});

/**
 * Workiz's relative line is moment.js `fromNow()`: "in 26 minutes",
 * "in an hour", "16 days ago", "in a few seconds" (list_01, list_07).
 */
describe("workizFromNow", () => {
  const now = new Date("2026-10-08T12:34:00.000Z");
  const at = (ms: number) => new Date(now.getTime() + ms);
  const MIN = 60_000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;

  it.each([
    [20_000, "in a few seconds"],
    [60_000, "in a minute"],
    [26 * MIN, "in 26 minutes"],
    [50 * MIN, "in an hour"],
    [2 * HOUR, "in 2 hours"],
    [8 * HOUR, "in 8 hours"],
    [26 * HOUR, "in a day"],
    [3 * DAY, "in 3 days"],
    [-16.4 * DAY, "16 days ago"],
    [-3 * HOUR, "3 hours ago"],
    [-30 * DAY, "a month ago"],
    [-90 * DAY, "3 months ago"],
    [-400 * DAY, "a year ago"],
    [-800 * DAY, "2 years ago"],
  ])("%d ms → %s", (ms, text) => {
    expect(workizFromNow(at(ms as number), now)).toBe(text);
  });
});

describe("workizScheduleCell — Workiz's Scheduled cell", () => {
  const now = new Date("2026-10-08T12:34:00.000Z"); // 08:34 in New York

  it("a job in another zone: the account's clock, then the place and its own clock", () => {
    // 5TU7ZA, Princeton TX, booked 08:00 Central.
    const cell = workizScheduleCell(
      { scheduledDate: "2026-10-08", scheduledTimeSlot: "08:00-09:00", city: "Princeton", zone: "America/Chicago" },
      ACCOUNT,
      now,
    );
    expect(cell).toEqual({
      when: "Thu Oct 08, 2026 09:00 am",
      area: { place: "Princeton", when: "Thu Oct 08, 2026 08:00 am" },
      relative: "in 26 minutes",
      past: false,
    });
  });

  it("a job on the account's own clock has no second block", () => {
    const cell = workizScheduleCell(
      { scheduledDate: "2026-10-08", scheduledTimeSlot: "10:00-12:00", city: "Norwich", zone: ACCOUNT },
      ACCOUNT,
      now,
    );
    expect(cell).toMatchObject({ when: "Thu Oct 08, 2026 10:00 am", area: null, relative: "in an hour", past: false });
  });

  it("a passed visit reads how long ago, and is marked past (Workiz paints it red)", () => {
    const cell = workizScheduleCell(
      { scheduledDate: "2026-09-21", scheduledTimeSlot: "22:15-23:15", city: "", zone: ACCOUNT },
      ACCOUNT,
      now,
    );
    expect(cell).toMatchObject({ when: "Mon Sep 21, 2026 10:15 pm", relative: "16 days ago", past: true });
  });

  it("no zone on the job means the account's", () => {
    const cell = workizScheduleCell({ scheduledDate: "2026-10-08", scheduledTimeSlot: "13:05-14:00", city: "X" }, ACCOUNT, now);
    expect(cell).toMatchObject({ when: "Thu Oct 08, 2026 01:05 pm", area: null });
  });

  it("an all-day or untimed visit shows the day alone, measured from its start", () => {
    const cell = workizScheduleCell({ scheduledDate: "2026-10-10", city: "X" }, ACCOUNT, now);
    expect(cell).toMatchObject({ when: "Sat Oct 10, 2026", area: null, relative: "in 2 days", past: false });
  });

  it("no date is Unscheduled, with nothing under it", () => {
    expect(workizScheduleCell({ city: "X" }, ACCOUNT, now)).toEqual({
      when: "Unscheduled",
      area: null,
      relative: null,
      past: false,
    });
  });
});
