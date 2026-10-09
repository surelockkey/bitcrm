import { describe, it, expect } from "vitest";
import type { JobType } from "@bitcrm/types";
import { formatJobTypeDuration, joinDuration, jobTypeDurationMinutes, splitDuration } from "./lib";

const jt = (over: Partial<JobType> = {}): JobType => ({
  id: "jt-1",
  name: "Rekey",
  priority: 0,
  active: true,
  createdBy: "u1",
  createdAt: "",
  updatedAt: "",
  ...over,
});

/**
 * Workiz's Duration on a job type (Days / Hours / Minutes — "How long does
 * this type of job usually take?"): the visit's length once the type is
 * picked, an hour when the type has none.
 */
describe("jobTypeDurationMinutes", () => {
  it("is the type's duration, an hour without one", () => {
    expect(jobTypeDurationMinutes(jt({ durationMinutes: 120 }))).toBe(120);
    expect(jobTypeDurationMinutes(jt())).toBe(60);
    expect(jobTypeDurationMinutes(jt({ durationMinutes: 0 }))).toBe(60);
    expect(jobTypeDurationMinutes(undefined)).toBe(60);
  });
});

describe("splitDuration / joinDuration — Workiz's three boxes", () => {
  it("splits minutes into days, hours and minutes and joins them back", () => {
    expect(splitDuration(3000)).toEqual({ days: 2, hours: 2, minutes: 0 });
    expect(splitDuration(90)).toEqual({ days: 0, hours: 1, minutes: 30 });
    expect(splitDuration(undefined)).toEqual({ days: 0, hours: 0, minutes: 0 });
    expect(joinDuration({ days: 2, hours: 2, minutes: 0 })).toBe(3000);
    expect(joinDuration({ days: 0, hours: 0, minutes: 0 })).toBe(0);
  });
});

describe("formatJobTypeDuration — the grid's Duration column", () => {
  it("prints Workiz's words: '2 hours', '1 hours'; days and minutes as the modal's boxes split them", () => {
    expect(formatJobTypeDuration(120)).toBe("2 hours");
    expect(formatJobTypeDuration(60)).toBe("1 hours");
    // The 50-hour type sits past the captured rows; the modal's Days / Hours boxes split it 2 / 2.
    expect(formatJobTypeDuration(3000)).toBe("2 days 2 hours");
    expect(formatJobTypeDuration(90)).toBe("1 hours 30 minutes");
    expect(formatJobTypeDuration(45)).toBe("45 minutes");
  });

  it("a type without a duration of its own shows the hour the pickers give it", () => {
    expect(formatJobTypeDuration(undefined)).toBe("1 hours");
    expect(formatJobTypeDuration(0)).toBe("1 hours");
  });
});
