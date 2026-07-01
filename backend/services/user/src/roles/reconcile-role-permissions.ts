import { type PermissionMatrix, type DataScopeRules } from '@bitcrm/types';

interface ReconcilableRole {
  permissions: PermissionMatrix;
  dataScope: DataScopeRules;
}

interface ReconcileResult {
  permissions: PermissionMatrix;
  dataScope: DataScopeRules;
  changed: boolean;
}

/**
 * Backfills permission/dataScope entries for resources that exist in the default
 * role definition but are missing from a persisted role — e.g. when a new
 * resource (technicians, skills, commission) is added to the registry after the
 * role was already seeded.
 *
 * Existing resource entries are NEVER overwritten, so manual permission edits and
 * intentionally-restrictive system-role settings are preserved. Only whole
 * missing resources are added.
 */
export function reconcileRolePermissions(
  role: ReconcilableRole,
  def: ReconcilableRole,
): ReconcileResult {
  const permissions: PermissionMatrix = { ...role.permissions };
  const dataScope: DataScopeRules = { ...role.dataScope };
  let changed = false;

  for (const resource of Object.keys(def.permissions)) {
    if (!(resource in permissions)) {
      permissions[resource] = { ...def.permissions[resource] };
      changed = true;
    }
  }

  for (const resource of Object.keys(def.dataScope)) {
    if (!(resource in dataScope)) {
      dataScope[resource] = def.dataScope[resource];
      changed = true;
    }
  }

  return { permissions, dataScope, changed };
}
