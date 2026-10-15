import { describe, expect, it } from "vitest";
import { formatDistance, timelineLocationNote } from "./timeline-location";

/**
 * Where the technician's phone was when they changed the status or arrived
 * (owner, 2026-10-15), as the deal service writes it on the timeline entry:
 * `details.location`, `details.distanceM`, `details.farFromAddress`.
 */
describe("formatDistance", () => {
  it("writes whole metres under a kilometre", () => {
    expect(formatDistance(0)).toBe("0 m");
    expect(formatDistance(120)).toBe("120 m");
    expect(formatDistance(120.4)).toBe("120 m");
    expect(formatDistance(999)).toBe("999 m");
  });

  it("writes kilometres with one decimal from 1000 m on", () => {
    expect(formatDistance(1000)).toBe("1.0 km");
    expect(formatDistance(14_200)).toBe("14.2 km");
    expect(formatDistance(14_249)).toBe("14.2 km");
    expect(formatDistance(1_234_567)).toBe("1,234.6 km");
  });

  it("never says 1000 m — what rounds up to a kilometre is one", () => {
    expect(formatDistance(999.6)).toBe("1.0 km");
  });
});

describe("timelineLocationNote", () => {
  const location = { lat: 41.7637, lng: -72.6851, accuracy: 9 };

  it("says how far from the address the fix was", () => {
    expect(timelineLocationNote({ location, distanceM: 120, farFromAddress: false })).toEqual({
      text: "120 m from the address",
      far: false,
    });
    expect(timelineLocationNote({ location, distanceM: 14_200, farFromAddress: true })).toEqual({
      text: "14.2 km from the address",
      far: true,
    });
  });

  it("is far only when the service said so", () => {
    expect(timelineLocationNote({ location, distanceM: 800 })?.far).toBe(false);
  });

  it("says only that a location was recorded when there is no distance (an address without coordinates)", () => {
    expect(timelineLocationNote({ location })).toEqual({ text: "location recorded", far: false });
  });

  it("is nothing without a usable fix — every change made on the web", () => {
    expect(timelineLocationNote({})).toBeNull();
    expect(timelineLocationNote(undefined)).toBeNull();
    expect(timelineLocationNote({ location: null, distanceM: 10 })).toBeNull();
    expect(timelineLocationNote({ location: { lat: "41.7" } })).toBeNull();
  });
});
