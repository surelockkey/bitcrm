import { DataScope } from "@bitcrm/types";
import type {
  User,
  PermissionMatrix,
  DataScopeRules,
  Resource,
  Action,
} from "@bitcrm/types";
import { SYSTEM_ROLES } from "./system-roles";

export interface ResolvedPermissions {
  roleId: string;
  roleName: string;
  permissions: PermissionMatrix;
  dataScope: DataScopeRules;
  isTechnician: boolean;
}

function mergePermissions(
  base: PermissionMatrix,
  overrides?: PermissionMatrix,
): PermissionMatrix {
  if (!overrides) return base;
  const out: PermissionMatrix = { ...base };
  for (const [resource, actions] of Object.entries(overrides)) {
    out[resource] = { ...(base[resource] ?? {}), ...actions };
  }
  return out;
}

/**
 * Resolve the current user's effective permissions from their role + per-user
 * overrides. Unknown/custom roles fall back to read-only (view everything) —
 * the backend still enforces real permissions on every request.
 */
export function resolvePermissions(
  user: User | null | undefined,
): ResolvedPermissions | null {
  if (!user) return null;
  const role = SYSTEM_ROLES[user.roleId];
  const base = role ?? SYSTEM_ROLES["role-read-only"];
  return {
    roleId: user.roleId,
    roleName: role?.name ?? "Custom",
    permissions: mergePermissions(
      base.permissions,
      user.permissionOverrides?.permissions,
    ),
    dataScope: {
      ...base.dataScope,
      ...(user.permissionOverrides?.dataScope ?? {}),
    },
    isTechnician: user.roleId === "role-technician",
  };
}

export function can(
  resolved: ResolvedPermissions | null,
  resource: Resource,
  action: Action = "view",
): boolean {
  return resolved?.permissions?.[resource]?.[action] ?? false;
}

export function scopeOf(
  resolved: ResolvedPermissions | null,
  resource: Resource,
): DataScope {
  return (resolved?.dataScope?.[resource] as DataScope) ?? DataScope.ASSIGNED_ONLY;
}
