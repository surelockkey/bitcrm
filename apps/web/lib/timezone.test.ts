import { describe, it, expect } from "vitest";
import {
  DEFAULT_TZ,
  US_TIMEZONES,
  tzLabel,
  clockInTz,
  formatInstant,
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
});
