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
 * role was already seeded. Also backfills a new ACTION added to an
 * already-present resource (e.g. `deals.move_status`), which a resource-only
 * merge would miss — leaving existing roles unable to use the new action.
 *
 * Existing values are NEVER overwritten: a present resource keeps its manual
 * edits, and a present action keeps its value (so an intentionally-disabled
 * action stays off). Only genuinely-missing resources/actions are added.
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
      // Whole resource is new — add it verbatim from the default.
      permissions[resource] = { ...def.permissions[resource] };
      changed = true;
      continue;
    }
    // Resource already present — backfill only actions the default added since,
    // cloning lazily so the caller's role object is never mutated and existing
    // action values are preserved.
    const defActions = def.permissions[resource];
    let roleActions = permissions[resource];
    for (const action of Object.keys(defActions)) {
      if (!(action in roleActions)) {
        if (roleActions === role.permissions[resource]) {
          roleActions = { ...roleActions };
          permissions[resource] = roleActions;
        }
        roleActions[action] = defActions[action];
        changed = true;
      }
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
