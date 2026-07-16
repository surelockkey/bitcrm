import { describe, it, expect } from "vitest";
import { createUserSchema, updateUserSchema } from "./schemas";

describe("createUserSchema", () => {
  const base = {
    firstName: "A",
    lastName: "B",
    email: "a@b.com",
    roleId: "role-dispatcher",
    department: "Phoenix",
  };
  it("accepts a valid payload", () => {
    expect(createUserSchema.safeParse(base).success).toBe(true);
  });
  it("rejects a bad email", () => {
    expect(createUserSchema.safeParse({ ...base, email: "nope" }).success).toBe(false);
  });
  it("requires a role", () => {
    expect(createUserSchema.safeParse({ ...base, roleId: "" }).success).toBe(false);
  });
  it("requires a department", () => {
    expect(createUserSchema.safeParse({ ...base, department: "" }).success).toBe(false);
  });
});

describe("updateUserSchema", () => {
  it("requires names + department", () => {
    expect(
      updateUserSchema.safeParse({ firstName: "A", lastName: "B", department: "X" }).success,
    ).toBe(true);
    expect(
      updateUserSchema.safeParse({ firstName: "", lastName: "B", department: "X" }).success,
    ).toBe(false);
  });
});
