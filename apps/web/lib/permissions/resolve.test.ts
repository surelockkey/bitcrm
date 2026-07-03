import { describe, it, expect } from "vitest";
import { UserStatus } from "@bitcrm/types";
import type { User } from "@bitcrm/types";
import { resolvePermissions, can, scopeOf } from "./resolve";
import { DataScope } from "@bitcrm/types";

function user(roleId: string, overrides?: User["permissionOverrides"]): User {
  return {
    id: "u1",
    cognitoSub: "sub",
    email: "a@b.com",
    firstName: "A",
    lastName: "B",
    roleId,
    department: "Phoenix",
    status: UserStatus.ACTIVE,
    permissionOverrides: overrides,
    createdAt: "",
    updatedAt: "",
  };
}

describe("resolvePermissions", () => {
  it("returns null without a user", () => {
    expect(resolvePermissions(null)).toBeNull();
  });

  it("resolves a dispatcher's capabilities", () => {
    const r = resolvePermissions(user("role-dispatcher"));
    expect(r?.roleName).toBe("Dispatcher");
    expect(r?.isTechnician).toBe(false);
    expect(can(r, "deals", "view")).toBe(true);
    expect(can(r, "deals", "create")).toBe(true);
    expect(can(r, "users", "view")).toBe(true);
    expect(can(r, "users", "create")).toBe(false);
    expect(can(r, "commission", "view")).toBe(false);
  });

  it("resolves a technician as the minimal shell role", () => {
    const r = resolvePermissions(user("role-technician"));
    expect(r?.isTechnician).toBe(true);
    expect(can(r, "deals", "view")).toBe(true);
    expect(can(r, "deals", "create")).toBe(false);
    expect(can(r, "users", "view")).toBe(false);
    expect(can(r, "roles", "view")).toBe(false);
    expect(scopeOf(r, "deals")).toBe(DataScope.ASSIGNED_ONLY);
  });

  it("merges per-user overrides on top of the role (user wins)", () => {
    const r = resolvePermissions(
      user("role-dispatcher", { permissions: { commission: { view: true } } }),
    );
    expect(can(r, "commission", "view")).toBe(true);
    expect(can(r, "deals", "view")).toBe(true); // untouched
  });

  it("falls back to read-only for an unknown/custom role", () => {
    const r = resolvePermissions(user("role-custom-xyz"));
    expect(r?.roleName).toBe("Custom");
    expect(r?.isTechnician).toBe(false);
    expect(can(r, "deals", "view")).toBe(true);
    expect(can(r, "deals", "create")).toBe(false);
  });
});
