import { describe, it, expect } from "vitest";
import { createUserSchema, toCreateUserRequest, updateUserSchema } from "./schemas";

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

  // Workiz "Add team member" → Subcontractor: "Can not login, can take jobs and
  // get messages" — and "Roles are not available for subcontractors".
  it("asks no role of a subcontractor", () => {
    expect(createUserSchema.safeParse({ ...base, roleId: "", userType: "subcontractor" }).success).toBe(true);
    expect(createUserSchema.safeParse({ ...base, roleId: "", userType: "regular" }).success).toBe(false);
  });
});

describe("toCreateUserRequest", () => {
  const values = {
    firstName: "Tyler",
    lastName: "Smith",
    email: "t@s.com",
    roleId: "role-dispatcher",
    department: "Field",
    phone: "",
  };

  it("sends a User as before: the role, and no type", () => {
    const body = toCreateUserRequest({ ...values, userType: "regular" });
    expect(body).toEqual({ ...values });
    expect("userType" in body).toBe(false);
  });

  it("sends a subcontractor without a role, typed", () => {
    expect(toCreateUserRequest({ ...values, userType: "subcontractor" })).toEqual({
      firstName: "Tyler",
      lastName: "Smith",
      email: "t@s.com",
      department: "Field",
      phone: "",
      userType: "subcontractor",
    });
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
