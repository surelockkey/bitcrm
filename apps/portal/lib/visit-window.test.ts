import { describe, expect, it } from "vitest";
import { formatConfirmedAt, formatVisit } from "./visit-window";

/**
 * The visit as the client reads it on the confirm page. The job keeps it as a
 * wall-clock day and slot in the job's own zone — the same clock the client
 * lives on — so it is printed as it is, never shifted through a time zone,
 * and the time says which zone it is in (owner, 2026-10-12).
 */
describe("formatVisit", () => {
  it("prints the day and the window, wall clock as stored", () => {
    expect(formatVisit({ scheduledDate: "2026-10-14", scheduledTimeSlot: "09:00-11:00" })).toEqual({
      day: "Wednesday, October 14, 2026",
      time: "9:00 AM – 11:00 AM EDT", // no zone sent: Connecticut
    });
    // An evening visit stays on its day whatever zone the phone is in.
    expect(formatVisit({ scheduledDate: "2026-10-14", scheduledTimeSlot: "21:30-23:00", timezone: "America/Los_Angeles" })).toEqual({
      day: "Wednesday, October 14, 2026",
      time: "9:30 PM – 11:00 PM PDT",
    });
  });

  it("names the job's zone for the day of the visit: a Texas job in summer and in winter", () => {
    expect(formatVisit({ scheduledDate: "2026-07-14", scheduledTimeSlot: "10:00-12:00", timezone: "America/Chicago" }).time).toBe(
      "10:00 AM – 12:00 PM CDT",
    );
    expect(formatVisit({ scheduledDate: "2026-12-14", scheduledTimeSlot: "10:00-12:00", timezone: "America/Chicago" }).time).toBe(
      "10:00 AM – 12:00 PM CST",
    );
  });

  it("says All day, and nothing for a visit without a time", () => {
    expect(formatVisit({ scheduledDate: "2026-10-14", allDay: true })).toEqual({ day: "Wednesday, October 14, 2026", time: "All day" });
    expect(formatVisit({ scheduledDate: "2026-10-14" })).toEqual({ day: "Wednesday, October 14, 2026" });
  });

  it("spans the days of a visit that runs over several", () => {
    expect(formatVisit({ scheduledDate: "2026-10-14", scheduledEndDate: "2026-10-15", scheduledTimeSlot: "09:00-17:00" })).toEqual({
      day: "Wednesday, October 14 – Thursday, October 15, 2026",
      time: "9:00 AM – 5:00 PM EDT",
    });
    // Over the clock change, each end says its own.
    expect(
      formatVisit({ scheduledDate: "2026-10-31", scheduledEndDate: "2026-11-02", scheduledTimeSlot: "09:00-17:00", timezone: "America/Chicago" }).time,
    ).toBe("9:00 AM CDT – 5:00 PM CST");
    expect(formatVisit({ scheduledDate: "2026-10-14", scheduledEndDate: "2026-10-14", scheduledTimeSlot: "09:00-10:00" }).day).toBe(
      "Wednesday, October 14, 2026",
    );
  });

  it("says the date is still to be set for an unscheduled job", () => {
    expect(formatVisit({})).toEqual({ day: "Date to be confirmed" });
  });

  it("ignores a slot it cannot read", () => {
    expect(formatVisit({ scheduledDate: "2026-10-14", scheduledTimeSlot: "soon" })).toEqual({ day: "Wednesday, October 14, 2026" });
  });
});

describe("formatConfirmedAt", () => {
  it("prints when the client confirmed, on the job's clock", () => {
    expect(formatConfirmedAt("2026-10-12T19:05:00.000Z", "America/New_York")).toBe("Oct 12, 3:05 PM EDT");
    expect(formatConfirmedAt("2026-10-12T19:05:00.000Z", "America/Chicago")).toBe("Oct 12, 2:05 PM CDT");
  });

  it("reads Connecticut — not the phone's zone — when the page has no zone", () => {
    expect(formatConfirmedAt("2026-10-12T19:05:00.000Z", undefined)).toBe("Oct 12, 3:05 PM EDT");
  });

  it("is empty for nothing usable", () => {
    expect(formatConfirmedAt(undefined, "America/New_York")).toBe("");
    expect(formatConfirmedAt("nope", "America/New_York")).toBe("");
  });
});
