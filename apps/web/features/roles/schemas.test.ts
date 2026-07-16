import { describe, it, expect } from "vitest";
import { roleDetailsSchema, createRoleSchema } from "./schemas";

describe("roleDetailsSchema", () => {
  const base = { name: "Regional Lead", description: "", priority: 50 };

  it("accepts a valid role", () => {
    expect(roleDetailsSchema.safeParse(base).success).toBe(true);
  });

  it("rejects a name shorter than 2 characters", () => {
    expect(roleDetailsSchema.safeParse({ ...base, name: "A" }).success).toBe(false);
  });

  it("trims and rejects a whitespace-only name", () => {
    expect(roleDetailsSchema.safeParse({ ...base, name: "   " }).success).toBe(false);
  });

  it("rejects a priority at or above Super Admin (100)", () => {
    expect(roleDetailsSchema.safeParse({ ...base, priority: 100 }).success).toBe(false);
  });

  it("rejects a priority below 1", () => {
    expect(roleDetailsSchema.safeParse({ ...base, priority: 0 }).success).toBe(false);
  });

  it("allows an omitted description", () => {
    const { description, ...noDesc } = base;
    void description;
    expect(roleDetailsSchema.safeParse(noDesc).success).toBe(true);
  });
});

describe("createRoleSchema", () => {
  const base = {
    name: "Regional Lead",
    description: "",
    startFromRoleId: "role-dept-manager",
    priority: 50,
  };

  it("accepts a valid create payload", () => {
    expect(createRoleSchema.safeParse(base).success).toBe(true);
  });

  it("requires a role to start from", () => {
    expect(createRoleSchema.safeParse({ ...base, startFromRoleId: "" }).success).toBe(false);
  });
});
