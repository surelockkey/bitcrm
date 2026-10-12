import { describe, it, expect } from "vitest";
import {
  DEFAULT_TZ,
  US_TIMEZONES,
  tzLabel,
  clockInTz,
  formatInstant,
  nowScheduleDefault,
  zoneAbbr,
  withZone,
  wallToCt,
  ctToZoneWall,
  ctToday,
  ctMinutesOfDay,
} from "./timezone";

describe("timezone lib", () => {
  it("defaults to Connecticut (Eastern) and lists it among US zones", () => {
    expect(DEFAULT_TZ).toBe("America/New_York");
    expect(US_TIMEZONES.some((t) => t.value === "America/New_York")).toBe(true);
  });

  it("labels a zone in plain words", () => {
    expect(tzLabel("America/New_York")).toMatch(/Eastern/);
    expect(tzLabel("America/Chicago")).toMatch(/Central/);
  });

  it("clockInTz renders the wall-clock time of an instant in a zone", () => {
    // 2026-08-19T16:00:00Z is 12:00 PM in New York (EDT, -4).
    const iso = "2026-08-19T16:00:00.000Z";
    expect(clockInTz(iso, "America/New_York")).toBe("12:00 PM");
    // …and 11:00 AM in Chicago (CDT, -5).
    expect(clockInTz(iso, "America/Chicago")).toBe("11:00 AM");
  });

  it("formatInstant shows date + time in the given zone", () => {
    const out = formatInstant("2026-08-19T16:00:00.000Z", "America/New_York");
    expect(out).toMatch(/Aug 19/);
    expect(out).toMatch(/12:00 PM/);
  });

  it("falls back to the default zone when none is given", () => {
    expect(clockInTz("2026-08-19T16:00:00.000Z")).toBe("12:00 PM");
  });

  it("nowScheduleDefault gives today + the next quarter hour + an hour later, in tz (Workiz)", () => {
    // 16:37Z is 12:37 PM in New York → up to 12:45, end 13:45, date the 19th.
    const at = new Date("2026-08-19T16:37:00.000Z");
    expect(nowScheduleDefault("America/New_York", at)).toEqual({
      date: "2026-08-19",
      start: "12:45",
      end: "13:45",
    });
    // new_12_client_picked_scroll0: "It's 7:53 AM in Princeton" → 08:00 AM to 09:00 AM.
    expect(nowScheduleDefault("America/Chicago", new Date("2026-10-08T12:53:00.000Z"))).toMatchObject({
      start: "08:00",
      end: "09:00",
    });
  });

  it("nowScheduleDefault keeps a time already on the quarter", () => {
    const at = new Date("2026-08-19T16:30:00.000Z");
    expect(nowScheduleDefault("America/New_York", at)).toMatchObject({ start: "12:30", end: "13:30" });
  });

  it("nowScheduleDefault clamps a late end to 23:45", () => {
    const at = new Date("2026-08-20T03:50:00.000Z"); // 11:50 PM EDT on the 19th
    expect(nowScheduleDefault("America/New_York", at)).toEqual({
      date: "2026-08-19",
      start: "23:45",
      end: "23:45",
    });
  });
});

/**
 * 2026-10-12 the owner's rule for the web app: every time it shows is on
 * Connecticut's clock (America/New_York) and says so — "09:34 am" alone was
 * read as the wrong zone. A visit is stored as the wall clock of the zone it
 * was booked in (Texas jobs in Central), so the web converts it.
 */
describe("Connecticut time, labelled", () => {
  it("names the zone at the instant: daylight and standard time", () => {
    expect(zoneAbbr("2026-10-12T13:34:39Z")).toBe("EDT");
    expect(zoneAbbr("2026-12-01T15:00:00Z")).toBe("EST");
    expect(zoneAbbr(new Date("2026-10-12T13:34:39Z"), "America/Chicago")).toBe("CDT");
    expect(zoneAbbr("2026-10-12T13:34:39Z", "America/Phoenix")).toBe("MST");
  });

  it("an unreadable instant has no label", () => {
    expect(zoneAbbr("not a date")).toBe("");
    expect(zoneAbbr(undefined)).toBe("");
  });

  it("withZone appends the label, and leaves an empty text empty", () => {
    expect(withZone("Mon Oct 12, 2026 09:34 am", "2026-10-12T13:34:39Z")).toBe(
      "Mon Oct 12, 2026 09:34 am EDT",
    );
    expect(withZone("", "2026-10-12T13:34:39Z")).toBe("");
  });

  it("a Texas visit booked for 10:00 is 11:00 in Connecticut", () => {
    expect(wallToCt("2026-10-12", "10:00", "America/Chicago")).toEqual({
      date: "2026-10-12",
      time: "11:00",
      abbr: "EDT",
      instant: new Date("2026-10-12T15:00:00Z"),
    });
  });

  it("a late Arizona visit can cross midnight onto Connecticut's next day", () => {
    // 22:30 MST (UTC-7) = 05:30Z = 01:30 EDT the next day.
    expect(wallToCt("2026-10-12", "22:30", "America/Phoenix")).toMatchObject({
      date: "2026-10-13",
      time: "01:30",
    });
  });

  it("a visit with no zone of its own is already on Connecticut's clock", () => {
    expect(wallToCt("2026-12-01", "09:00", undefined)).toMatchObject({
      date: "2026-12-01",
      time: "09:00",
      abbr: "EST",
    });
  });

  it("ctFromWall goes back: Connecticut 11:00 is 10:00 for a Texas job", () => {
    expect(ctToZoneWall("2026-10-12", "11:00", "America/Chicago")).toEqual({
      date: "2026-10-12",
      time: "10:00",
    });
  });

  it("today and the minute of the day on Connecticut's clock, whatever the browser's", () => {
    // 03:30Z on Oct 13 is still Oct 12, 23:30 in Connecticut.
    const at = new Date("2026-10-13T03:30:00Z");
    expect(ctToday(at)).toBe("2026-10-12");
    expect(ctMinutesOfDay(at)).toBe(23 * 60 + 30);
  });
});
