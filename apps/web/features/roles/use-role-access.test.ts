import { describe, it, expect } from "vitest";
import type { Role } from "@bitcrm/types";
import { roleEditability } from "./use-role-access";

function role(over: Partial<Role>): Role {
  return {
    id: "role-x",
    name: "Custom",
    permissions: {},
    dataScope: {},
    dealStageTransitions: [],
    isSystem: false,
    priority: 50,
    createdAt: "",
    updatedAt: "",
    ...over,
  };
}

const admin = { canEditRoles: true, canDeleteRoles: true, myPriority: 80, amSuperAdmin: false };

describe("roleEditability", () => {
  it("Super Admin is locked — never editable or deletable", () => {
    const r = role({ isSystem: true, name: "Super Admin", priority: 100 });
    const e = roleEditability(r, { ...admin, amSuperAdmin: true, myPriority: 100 });
    expect(e.locked).toBe(true);
    expect(e.editable).toBe(false);
    expect(e.deletable).toBe(false);
  });

  it("a role at or above the caller's priority is view-only", () => {
    const r = role({ priority: 80 });
    const e = roleEditability(r, { ...admin, myPriority: 80 });
    expect(e.aboveMe).toBe(true);
    expect(e.editable).toBe(false);
    expect(e.deletable).toBe(false);
    expect(e.deleteReason).toMatch(/rank/i);
  });

  it("an editable custom role below the caller can be edited", () => {
    const e = roleEditability(role({ priority: 40 }), admin);
    expect(e.editable).toBe(true);
  });

  it("system roles are editable (except Super Admin) but never deletable", () => {
    const r = role({ isSystem: true, name: "Dispatcher", priority: 40 });
    const e = roleEditability(r, { ...admin, memberCount: 0 });
    expect(e.editable).toBe(true);
    expect(e.deletable).toBe(false);
    expect(e.deleteReason).toMatch(/system/i);
  });

  it("a custom role with members cannot be deleted and says why", () => {
    const e = roleEditability(role({ priority: 40 }), { ...admin, memberCount: 3 });
    expect(e.deletable).toBe(false);
    expect(e.deleteReason).toMatch(/3/);
  });

  it("a custom role with no members is deletable", () => {
    const e = roleEditability(role({ priority: 40 }), { ...admin, memberCount: 0 });
    expect(e.deletable).toBe(true);
    expect(e.deleteReason).toBeUndefined();
  });

  it("missing the roles.edit permission blocks editing", () => {
    const e = roleEditability(role({ priority: 40 }), { ...admin, canEditRoles: false });
    expect(e.editable).toBe(false);
  });
});
