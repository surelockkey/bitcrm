import { describe, it, expect } from "vitest";
import { jobTypeFormSchema, toJobTypeBody } from "./schemas";

describe("jobTypeFormSchema", () => {
  it("accepts a valid form and coerces priority", () => {
    const parsed = jobTypeFormSchema.parse({ name: "Lockout", priority: "5", active: true });
    expect(parsed).toMatchObject({ name: "Lockout", priority: 5, active: true });
  });

  it("trims the name and rejects an empty one", () => {
    expect(jobTypeFormSchema.safeParse({ name: "   " }).success).toBe(false);
  });

  it("defaults priority to 0, active to true and the duration boxes to 0 / 0 / 0", () => {
    const parsed = jobTypeFormSchema.parse({ name: "Rekey" });
    expect(parsed.priority).toBe(0);
    expect(parsed.active).toBe(true);
    expect(parsed).toMatchObject({ days: 0, hours: 0, minutes: 0 });
  });

  it("keeps the duration boxes to Workiz's ranges (Days 0–31, Hours 0–23, Minutes 0–59)", () => {
    expect(jobTypeFormSchema.safeParse({ name: "Safe", days: "32" }).success).toBe(false);
    expect(jobTypeFormSchema.safeParse({ name: "Safe", hours: "24" }).success).toBe(false);
    expect(jobTypeFormSchema.safeParse({ name: "Safe", minutes: "60" }).success).toBe(false);
    expect(jobTypeFormSchema.safeParse({ name: "Safe", days: "31", hours: "23", minutes: "59" }).success).toBe(true);
  });

  it("maps to the request body, the three boxes as one durationMinutes", () => {
    const body = toJobTypeBody({ name: "Safe", priority: 3, active: false, days: 2, hours: 2, minutes: 0 });
    expect(body).toEqual({ name: "Safe", priority: 3, active: false, durationMinutes: 3000 });
    expect(toJobTypeBody({ name: "Safe", priority: 0, active: true, days: 0, hours: 0, minutes: 0 }).durationMinutes).toBe(0);
  });
});
