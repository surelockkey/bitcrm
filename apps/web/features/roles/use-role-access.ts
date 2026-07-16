"use client";

import type { Role } from "@bitcrm/types";
import { usePermissions } from "@/features/auth/use-permissions";
import { useHierarchy } from "@/features/users/use-can-manage";
import { isSuperAdmin } from "./lib";

export interface RoleAccessContext {
  canEditRoles: boolean;
  canDeleteRoles: boolean;
  myPriority: number;
  amSuperAdmin: boolean;
  /** Known assigned-user count, if loaded — gates deletion. */
  memberCount?: number;
}

export interface RoleEditability {
  /** The immutable Super Admin role. */
  locked: boolean;
  /** Role ranks at or above the caller — view-only per the server guard. */
  aboveMe: boolean;
  editable: boolean;
  deletable: boolean;
  /** Human reason deletion is blocked, when it is. */
  deleteReason?: string;
}

/**
 * Pure mirror of the backend's role guards:
 * - Super Admin is immutable (edit + delete 403).
 * - You may only touch roles below your own priority (Super Admin: any).
 * - System roles can never be deleted; custom roles can't be deleted while
 *   users are assigned.
 */
export function roleEditability(
  role: Role,
  ctx: RoleAccessContext,
): RoleEditability {
  const locked = isSuperAdmin(role);
  const aboveMe = !ctx.amSuperAdmin && role.priority >= ctx.myPriority;

  const editable = ctx.canEditRoles && !locked && !aboveMe;

  let deleteReason: string | undefined;
  if (locked) deleteReason = "The Super Admin role can't be changed.";
  else if (aboveMe) deleteReason = "This role ranks at or above yours.";
  else if (role.isSystem) deleteReason = "System roles can't be deleted.";
  else if (!ctx.canDeleteRoles) deleteReason = "You don't have permission to delete roles.";
  else if ((ctx.memberCount ?? 0) > 0) {
    const n = ctx.memberCount ?? 0;
    deleteReason = `${n} ${n === 1 ? "user" : "users"} still hold this role — reassign them first.`;
  }

  const deletable = !deleteReason;
  return { locked, aboveMe, editable, deletable, deleteReason };
}

/** Hook wiring the current caller's permissions + hierarchy into the guards. */
export function useRoleAccess() {
  const { can } = usePermissions();
  const { myPriority, amSuperAdmin } = useHierarchy();

  const ctx = {
    canEditRoles: can("roles", "edit"),
    canDeleteRoles: can("roles", "delete"),
    myPriority,
    amSuperAdmin,
  };

  return {
    ...ctx,
    canViewRoles: can("roles", "view"),
    canCreateRoles: can("roles", "create"),
    editabilityOf: (role: Role, memberCount?: number) =>
      roleEditability(role, { ...ctx, memberCount }),
  };
}
