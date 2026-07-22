import { describe, it, expect } from "vitest";
import { jobSourceFormSchema, toJobSourceBody } from "./schemas";

describe("jobSourceFormSchema", () => {
  it("accepts a valid form and coerces priority", () => {
    const parsed = jobSourceFormSchema.parse({ name: "Lockout", priority: "5", active: true });
    expect(parsed).toEqual({ name: "Lockout", priority: 5, active: true });
  });

  it("trims the name and rejects an empty one", () => {
    expect(jobSourceFormSchema.safeParse({ name: "   " }).success).toBe(false);
  });

  it("defaults priority to 0 and active to true", () => {
    const parsed = jobSourceFormSchema.parse({ name: "Rekey" });
    expect(parsed.priority).toBe(0);
    expect(parsed.active).toBe(true);
  });

  it("maps to the request body", () => {
    const body = toJobSourceBody({ name: "Safe", priority: 3, active: false });
    expect(body).toEqual({ name: "Safe", priority: 3, active: false });
  });
});
