import { describe, it, expect } from "vitest";
import {
  DEFAULT_TZ,
  US_TIMEZONES,
  tzLabel,
  clockInTz,
  formatInstant,
  nowScheduleDefault,
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

  it("nowScheduleDefault gives today + now (floored to 15) + an hour later, in tz", () => {
    // 16:37Z is 12:37 PM in New York → floored 12:30, end 13:30, date the 19th.
    const at = new Date("2026-08-19T16:37:00.000Z");
    expect(nowScheduleDefault("America/New_York", at)).toEqual({
      date: "2026-08-19",
      start: "12:30",
      end: "13:30",
    });
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
