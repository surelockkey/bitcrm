import { describe, it, expect } from "vitest";
import {
  loginSchema,
  setPasswordSchema,
  forgotSchema,
  resetConfirmSchema,
  passwordChecks,
} from "./schemas";

describe("loginSchema", () => {
  it("accepts a valid email + password", () => {
    expect(loginSchema.safeParse({ email: "a@b.com", password: "x" }).success).toBe(true);
  });
  it("rejects a bad email", () => {
    expect(loginSchema.safeParse({ email: "nope", password: "x" }).success).toBe(false);
  });
  it("rejects an empty password", () => {
    expect(loginSchema.safeParse({ email: "a@b.com", password: "" }).success).toBe(false);
  });
});

describe("passwordChecks (live checklist)", () => {
  it("flags each rule independently", () => {
    expect(passwordChecks("short")).toEqual({ length: false, uppercase: false, number: false });
    expect(passwordChecks("Longenough1")).toEqual({ length: true, uppercase: true, number: true });
    expect(passwordChecks("alllowercase1")).toEqual({ length: true, uppercase: false, number: true });
    expect(passwordChecks("NoNumbersHere")).toEqual({ length: true, uppercase: true, number: false });
  });
});

describe("setPasswordSchema", () => {
  const base = { newPassword: "Password1", confirmPassword: "Password1" };
  it("accepts a strong, matching password", () => {
    expect(setPasswordSchema.safeParse(base).success).toBe(true);
  });
  it("rejects a weak new password", () => {
    expect(
      setPasswordSchema.safeParse({ newPassword: "weak", confirmPassword: "weak" }).success,
    ).toBe(false);
  });
  it("rejects a mismatched confirmation", () => {
    expect(setPasswordSchema.safeParse({ ...base, confirmPassword: "Different1" }).success).toBe(false);
  });
});

describe("forgotSchema", () => {
  it("validates the email", () => {
    expect(forgotSchema.safeParse({ email: "a@b.com" }).success).toBe(true);
    expect(forgotSchema.safeParse({ email: "no" }).success).toBe(false);
  });
});

describe("resetConfirmSchema", () => {
  const base = {
    email: "a@b.com",
    code: "123456",
    newPassword: "Password1",
    confirmPassword: "Password1",
  };
  it("accepts a valid code + strong matching password", () => {
    expect(resetConfirmSchema.safeParse(base).success).toBe(true);
  });
  it("rejects a code that is not 6 digits", () => {
    expect(resetConfirmSchema.safeParse({ ...base, code: "123" }).success).toBe(false);
  });
  it("rejects a mismatched confirmation", () => {
    expect(resetConfirmSchema.safeParse({ ...base, confirmPassword: "Other1234" }).success).toBe(false);
  });
});
