import { describe, it, expect } from "vitest";
import { jobTypeFormSchema, toJobTypeBody } from "./schemas";

describe("jobTypeFormSchema", () => {
  it("accepts a valid form and coerces priority", () => {
    const parsed = jobTypeFormSchema.parse({ name: "Lockout", priority: "5", active: true });
    expect(parsed).toEqual({ name: "Lockout", priority: 5, active: true });
  });

  it("trims the name and rejects an empty one", () => {
    expect(jobTypeFormSchema.safeParse({ name: "   " }).success).toBe(false);
  });

  it("defaults priority to 0 and active to true", () => {
    const parsed = jobTypeFormSchema.parse({ name: "Rekey" });
    expect(parsed.priority).toBe(0);
    expect(parsed.active).toBe(true);
  });

  it("maps to the request body", () => {
    const body = toJobTypeBody({ name: "Safe", priority: 3, active: false });
    expect(body).toEqual({ name: "Safe", priority: 3, active: false });
  });
});
