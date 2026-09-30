"use client";

import type { User, Role } from "@bitcrm/types";
import { usePermissions } from "@/features/auth/use-permissions";
import { ROLE_PRIORITY } from "@/lib/permissions/system-roles";
import { useRoles } from "./hooks";

type Caller = { id: string; roleId: string } | null;

export interface Hierarchy {
  myPriority: number;
  amSuperAdmin: boolean;
  priorityOf: (roleId: string) => number;
  isSelf: (u: User) => boolean;
  /** Caller may manage (deactivate/role/overrides) a user strictly below them. */
  canManage: (u: User) => boolean;
  /**
   * Caller may edit a user's profile: anyone they manage, and themselves. The
   * backend's profile update carries no hierarchy guard — `users.edit` is
   * enough — and an owner has to be able to switch THEMSELVES onto the field
   * team. Role, overrides and deactivation stay `canManage`.
   */
  canEditProfile: (u: User) => boolean;
  /** Roles the caller may assign (below their own; Super Admin: any). */
  assignableRoles: (roles: Role[]) => Role[];
}

/** Pure hierarchy logic — mirrors the backend's role-priority guards. */
export function computeHierarchy(caller: Caller, roles: Role[]): Hierarchy {
  const priorityOf = (roleId: string): number =>
    roles.find((r) => r.id === roleId)?.priority ?? ROLE_PRIORITY[roleId] ?? 0;

  const myPriority = caller ? priorityOf(caller.roleId) : 0;
  const amSuperAdmin = myPriority >= 100;
  const isSelf = (u: User) => caller?.id === u.id;
  const canManage = (u: User) =>
    !!caller && caller.id !== u.id && myPriority > priorityOf(u.roleId);

  return {
    myPriority,
    amSuperAdmin,
    priorityOf,
    isSelf,
    canManage,
    canEditProfile: (u) => canManage(u) || isSelf(u),
    assignableRoles: (all) =>
      all.filter((r) => amSuperAdmin || r.priority < myPriority),
  };
}

export function useHierarchy(): Hierarchy & { roles: Role[] } {
  const { me } = usePermissions();
  const { data: roles } = useRoles();
  const list = roles ?? [];
  const h = computeHierarchy(
    me ? { id: me.id, roleId: me.roleId } : null,
    list,
  );
  return { ...h, roles: list };
}
