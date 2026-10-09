import { describe, it, expect } from "vitest";
import { createUserSchema, splitFullName, toCreateUserRequest, updateUserSchema } from "./schemas";

/**
 * Workiz's "Add team member" asks one "Name" (subcontractor_wz_04_add_new_user);
 * our record keeps first and last name apart, so the box splits on the first
 * space, as the New Job client name does (app_audit #10).
 */
describe("splitFullName", () => {
  it("takes the first word as the first name and the rest as the last", () => {
    expect(splitFullName("Tyler Smith")).toEqual({ firstName: "Tyler", lastName: "Smith" });
    expect(splitFullName("Mary Ann Smith")).toEqual({ firstName: "Mary", lastName: "Ann Smith" });
    expect(splitFullName("  Tyler   Smith ")).toEqual({ firstName: "Tyler", lastName: "Smith" });
  });

  it("leaves the last name empty for one word, both for nothing", () => {
    expect(splitFullName("Tyler")).toEqual({ firstName: "Tyler", lastName: "" });
    expect(splitFullName("   ")).toEqual({ firstName: "", lastName: "" });
  });
});

describe("createUserSchema", () => {
  const base = {
    name: "A B",
    email: "a@b.com",
    roleId: "role-dispatcher",
    department: "Phoenix",
  };
  it("accepts a valid payload, Field tech and Track Location on by default (Workiz's Yes / Yes)", () => {
    const parsed = createUserSchema.safeParse(base);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data).toMatchObject({ fieldTeamMember: true, gpsTrackingEnabled: true });
  });
  it("needs a first and a last name in the one Name box", () => {
    expect(createUserSchema.safeParse({ ...base, name: "" }).success).toBe(false);
    expect(createUserSchema.safeParse({ ...base, name: "Tyler" }).success).toBe(false);
    const oneWord = createUserSchema.safeParse({ ...base, name: "Tyler" });
    expect(!oneWord.success && oneWord.error.issues[0].message).toBe("Enter first and last name");
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
  it("takes a phone only when it is dialable", () => {
    expect(createUserSchema.safeParse({ ...base, phone: "" }).success).toBe(true);
    expect(createUserSchema.safeParse({ ...base, phone: "+14045551234" }).success).toBe(true);
    expect(createUserSchema.safeParse({ ...base, phone: "404" }).success).toBe(false);
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
    name: "Tyler Smith",
    email: "t@s.com",
    roleId: "role-dispatcher",
    department: "Field",
    phone: "",
    fieldTeamMember: true,
    gpsTrackingEnabled: false,
  };

  it("sends a User with the role, the split name, Field tech and Track Location, and no type", () => {
    const body = toCreateUserRequest({ ...values, userType: "regular" });
    expect(body).toEqual({
      email: "t@s.com",
      firstName: "Tyler",
      lastName: "Smith",
      roleId: "role-dispatcher",
      department: "Field",
      fieldTeamMember: true,
      gpsTrackingEnabled: false,
    });
    expect("userType" in body).toBe(false);
    expect("phone" in body).toBe(false);
  });

  it("sends the phone when there is one", () => {
    expect(toCreateUserRequest({ ...values, userType: "regular", phone: "+14045551234" })).toMatchObject({ phone: "+14045551234" });
  });

  it("sends a subcontractor without a role, Field tech or Track Location (the API decides those), typed", () => {
    expect(toCreateUserRequest({ ...values, userType: "subcontractor" })).toEqual({
      firstName: "Tyler",
      lastName: "Smith",
      email: "t@s.com",
      department: "Field",
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
