import { describe, it, expect } from "vitest";
import { jobTagFormSchema, toJobTagBody } from "./schemas";

describe("jobTagFormSchema", () => {
  it("accepts a valid form and coerces priority", () => {
    const parsed = jobTagFormSchema.parse({ name: "Rush", color: "red", priority: "5", active: true });
    expect(parsed).toEqual({ name: "Rush", color: "red", priority: 5, active: true });
  });

  it("trims the name and rejects an empty one", () => {
    expect(jobTagFormSchema.safeParse({ name: "   ", color: "red" }).success).toBe(false);
  });

  it("rejects a color outside the palette", () => {
    expect(jobTagFormSchema.safeParse({ name: "Rush", color: "chartreuse" }).success).toBe(false);
  });

  it("defaults color to slate, priority to 0 and active to true", () => {
    const parsed = jobTagFormSchema.parse({ name: "Repeat" });
    expect(parsed.color).toBe("slate");
    expect(parsed.priority).toBe(0);
    expect(parsed.active).toBe(true);
  });

  it("maps to the request body", () => {
    const body = toJobTagBody({ name: "VIP", color: "violet", priority: 3, active: false });
    expect(body).toEqual({ name: "VIP", color: "violet", priority: 3, active: false });
  });
});
