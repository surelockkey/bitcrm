import { DataScope } from "@bitcrm/types";
import type {
  User,
  PermissionMatrix,
  DataScopeRules,
  Resource,
  Action,
  ResolvedPermissions as ServerResolvedPermissions,
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
 * `/users/me` as user-service answers it: the profile plus, when it could be
 * resolved, the matrix the permission guards enforce (role + overrides).
 */
export type MeUser = User & { resolvedPermissions?: ServerResolvedPermissions };

/**
 * Resolve the current user's effective permissions.
 *
 * The server's matrix when `/me` carries it — what the role editor saved, the
 * person's overrides on top, exactly what every guard enforces — so an edited
 * role and a custom role gate the screens as they gate the API. Without it
 * (a user-service from before the field, or a role it could not resolve) the
 * client mirror of the seeded roles + the overrides; a role the mirror does
 * not know reads as Read Only. The backend enforces the real permissions on
 * every request either way.
 */
export function resolvePermissions(
  user: MeUser | null | undefined,
): ResolvedPermissions | null {
  if (!user) return null;
  const server = user.resolvedPermissions;
  if (server?.permissions) {
    return {
      roleId: user.roleId,
      roleName: server.roleName || SYSTEM_ROLES[user.roleId]?.name || "Custom",
      permissions: server.permissions,
      dataScope: server.dataScope ?? {},
      isTechnician: user.roleId === "role-technician",
    };
  }
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
