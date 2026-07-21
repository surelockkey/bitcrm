import { DataScope, RESOURCE_REGISTRY } from "@bitcrm/types";
import type { PermissionMatrix, DataScopeRules } from "@bitcrm/types";

/**
 * Client mirror of the backend's seeded system roles
 * (backend/services/user/src/roles/constants/default-roles.ts).
 *
 * WHY: there is no self-serve "my resolved permissions" endpoint for non-admin
 * roles (`/users/:id/permissions` requires `users.view`). So we resolve the
 * current user's permissions from their `roleId` (returned by `/users/me`) plus
 * any per-user overrides. When a `/me/permissions` endpoint exists, swap the
 * resolver to use the server value and delete this file.
 *
 * Keep in sync with the backend constant.
 */

const crud = (view: boolean, create: boolean, edit: boolean, del: boolean) => ({
  view,
  create,
  edit,
  delete: del,
});

/** Build a full data-scope map from a base default + per-resource overrides. */
function scopes(
  base: DataScope,
  overrides: Partial<DataScopeRules> = {},
): DataScopeRules {
  const out: DataScopeRules = {};
  for (const resource of Object.keys(RESOURCE_REGISTRY)) {
    out[resource] = overrides[resource] ?? base;
  }
  return out;
}

export interface SystemRole {
  id: string;
  name: string;
  permissions: PermissionMatrix;
  dataScope: DataScopeRules;
}

export const SYSTEM_ROLES: Record<string, SystemRole> = {
  "role-super-admin": {
    id: "role-super-admin",
    name: "Super Admin",
    permissions: {
      deals: crud(true, true, true, true),
      service_areas: crud(true, true, true, true),
      contacts: crud(true, true, true, true),
      companies: crud(true, true, true, true),
      products: crud(true, true, true, true),
      warehouses: crud(true, true, true, true),
      containers: crud(true, true, true, true),
      transfers: crud(true, true, true, true),
      users: crud(true, true, true, true),
      roles: crud(true, true, true, true),
      reports: crud(true, true, true, true),
      settings: { view: true, edit: true },
      technicians: crud(true, true, true, true),
      skills: { view: true, propose: true, approve: true, revoke: true },
      commission: { view: true, edit: true },
      documents: { view: true, upload: true, delete: true },
    },
    dataScope: scopes(DataScope.ALL),
  },
  "role-admin": {
    id: "role-admin",
    name: "Admin",
    permissions: {
      deals: crud(true, true, true, true),
      service_areas: crud(true, true, true, true),
      contacts: crud(true, true, true, true),
      companies: crud(true, true, true, true),
      products: crud(true, true, true, false),
      warehouses: crud(true, true, true, false),
      containers: crud(true, true, true, false),
      transfers: crud(true, true, true, false),
      users: crud(true, true, true, true),
      roles: crud(true, false, false, false),
      reports: crud(true, true, true, false),
      settings: { view: true, edit: true },
      technicians: crud(true, true, true, true),
      skills: { view: true, propose: false, approve: true, revoke: true },
      commission: { view: true, edit: true },
      documents: { view: true, upload: false, delete: true },
    },
    dataScope: scopes(DataScope.ALL),
  },
  "role-dept-manager": {
    id: "role-dept-manager",
    name: "Department Manager",
    permissions: {
      deals: crud(true, true, true, false),
      service_areas: crud(true, true, true, false),
      contacts: crud(true, true, true, false),
      companies: crud(true, true, true, false),
      products: crud(true, false, false, false),
      warehouses: crud(true, false, false, false),
      containers: crud(true, false, false, false),
      transfers: crud(true, false, false, false),
      users: crud(true, true, true, false),
      roles: crud(true, false, false, false),
      reports: crud(true, true, true, false),
      settings: { view: true, edit: false },
      technicians: crud(true, true, true, false),
      skills: { view: true, propose: false, approve: true, revoke: true },
      commission: { view: true, edit: true },
      documents: { view: true, upload: false, delete: false },
    },
    dataScope: scopes(DataScope.DEPARTMENT, {
      products: DataScope.ALL,
      warehouses: DataScope.ALL,
      containers: DataScope.ALL,
      roles: DataScope.ALL,
      settings: DataScope.ALL,
    }),
  },
  "role-dispatcher": {
    id: "role-dispatcher",
    name: "Dispatcher",
    permissions: {
      deals: crud(true, true, true, false),
      service_areas: crud(true, false, false, false),
      contacts: crud(true, true, true, false),
      companies: crud(true, false, false, false),
      products: crud(true, false, false, false),
      warehouses: crud(true, false, false, false),
      containers: crud(true, false, false, false),
      transfers: crud(true, false, false, false),
      users: crud(true, false, false, false),
      roles: crud(true, false, false, false),
      reports: crud(true, false, false, false),
      settings: { view: true, edit: false },
      technicians: crud(true, false, false, false),
      skills: { view: true, propose: false, approve: false, revoke: false },
      commission: { view: false, edit: false },
      documents: { view: false, upload: false, delete: false },
    },
    dataScope: scopes(DataScope.DEPARTMENT, {
      products: DataScope.ALL,
      warehouses: DataScope.ALL,
      containers: DataScope.ALL,
      roles: DataScope.ALL,
      settings: DataScope.ALL,
    }),
  },
  "role-technician": {
    id: "role-technician",
    name: "Technician",
    permissions: {
      deals: crud(true, false, true, false),
      service_areas: crud(true, false, false, false),
      contacts: crud(true, false, false, false),
      companies: crud(true, false, false, false),
      products: crud(true, false, false, false),
      warehouses: crud(false, false, false, false),
      containers: crud(true, false, false, false),
      transfers: crud(true, false, false, false),
      users: crud(false, false, false, false),
      roles: crud(false, false, false, false),
      reports: crud(false, false, false, false),
      settings: { view: false, edit: false },
      technicians: crud(true, false, true, false),
      skills: { view: true, propose: true, approve: false, revoke: false },
      commission: { view: true, edit: false },
      documents: { view: true, upload: true, delete: false },
    },
    dataScope: scopes(DataScope.ASSIGNED_ONLY, {
      products: DataScope.ALL,
      roles: DataScope.ALL,
      settings: DataScope.ALL,
    }),
  },
  "role-read-only": {
    id: "role-read-only",
    name: "Read Only",
    permissions: {
      deals: crud(true, false, false, false),
      service_areas: crud(true, false, false, false),
      contacts: crud(true, false, false, false),
      companies: crud(true, false, false, false),
      products: crud(true, false, false, false),
      warehouses: crud(true, false, false, false),
      containers: crud(true, false, false, false),
      transfers: crud(true, false, false, false),
      users: crud(true, false, false, false),
      roles: crud(true, false, false, false),
      reports: crud(true, false, false, false),
      settings: { view: true, edit: false },
      technicians: crud(true, false, false, false),
      skills: { view: true, propose: false, approve: false, revoke: false },
      commission: { view: true, edit: false },
      documents: { view: false, upload: false, delete: false },
    },
    dataScope: scopes(DataScope.ALL),
  },
};

export const TECHNICIAN_ROLE_ID = "role-technician";

/** System-role priorities (higher = more powerful). Fallback for hierarchy
 *  checks when the live roles list (with priorities) isn't available. */
export const ROLE_PRIORITY: Record<string, number> = {
  "role-super-admin": 100,
  "role-admin": 80,
  "role-dept-manager": 60,
  "role-dispatcher": 40,
  "role-technician": 20,
  "role-read-only": 10,
};

export function systemRoleName(roleId: string): string | undefined {
  return SYSTEM_ROLES[roleId]?.name;
}
