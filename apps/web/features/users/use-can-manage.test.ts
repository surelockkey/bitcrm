import { describe, it, expect } from "vitest";
import type { Role, User } from "@bitcrm/types";
import { computeHierarchy } from "./use-can-manage";

const roles = [
  { id: "role-super-admin", name: "Super Admin", priority: 100 },
  { id: "role-admin", name: "Admin", priority: 80 },
  { id: "role-dispatcher", name: "Dispatcher", priority: 40 },
  { id: "role-technician", name: "Technician", priority: 20 },
] as Role[];

const user = (id: string, roleId: string) => ({ id, roleId }) as User;

describe("computeHierarchy", () => {
  it("dispatcher manages a technician but not an admin or self", () => {
    const h = computeHierarchy({ id: "me", roleId: "role-dispatcher" }, roles);
    expect(h.canManage(user("t", "role-technician"))).toBe(true);
    expect(h.canManage(user("a", "role-admin"))).toBe(false);
    expect(h.canManage(user("me", "role-dispatcher"))).toBe(false);
    expect(h.isSelf(user("me", "role-dispatcher"))).toBe(true);
  });

  it("super admin cannot manage another super admin (equal priority)", () => {
    const h = computeHierarchy({ id: "me", roleId: "role-super-admin" }, roles);
    expect(h.canManage(user("other", "role-super-admin"))).toBe(false);
    expect(h.canManage(user("a", "role-admin"))).toBe(true);
    expect(h.amSuperAdmin).toBe(true);
  });

  /**
   * The backend's profile update carries no hierarchy guard — `users.edit` is
   * enough — and an owner has to be able to switch THEMSELVES onto the field
   * team. So the profile tab opens for yourself as well as for anyone you
   * manage; role, overrides and deactivation stay strictly-below-you.
   */
  it("lets anyone edit their own profile, and the profile of anyone they manage", () => {
    const admin = computeHierarchy({ id: "me", roleId: "role-admin" }, roles);
    expect(admin.canEditProfile(user("me", "role-admin"))).toBe(true);
    expect(admin.canEditProfile(user("t", "role-technician"))).toBe(true);
    expect(admin.canEditProfile(user("peer", "role-admin"))).toBe(false);
    expect(admin.canEditProfile(user("boss", "role-super-admin"))).toBe(false);
    expect(admin.canManage(user("me", "role-admin"))).toBe(false);
  });

  it("assignableRoles excludes roles at/above a non-super caller", () => {
    const h = computeHierarchy({ id: "me", roleId: "role-admin" }, roles);
    const ids = h.assignableRoles(roles).map((r) => r.id);
    expect(ids).toContain("role-dispatcher");
    expect(ids).toContain("role-technician");
    expect(ids).not.toContain("role-admin");
    expect(ids).not.toContain("role-super-admin");
  });

  it("super admin can assign any role", () => {
    const h = computeHierarchy({ id: "me", roleId: "role-super-admin" }, roles);
    expect(h.assignableRoles(roles)).toHaveLength(roles.length);
  });

  it("no caller manages nobody", () => {
    const h = computeHierarchy(null, roles);
    expect(h.canManage(user("t", "role-technician"))).toBe(false);
  });
});
