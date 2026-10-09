import { DataScope } from "@bitcrm/types";
import type {
  DataScopeRules,
  PermissionMatrix,
  Role,
  UserPermissionOverrides,
} from "@bitcrm/types";
import { isAllowed, type Schema } from "@/features/roles/lib";

/**
 * The overrides editor's working state: the user's *effective* values edited
 * directly. Saving diffs them against the role base to produce the sparse
 * override object the backend stores.
 */
export interface OverridesDraft {
  permissions: PermissionMatrix;
  dataScope: DataScopeRules;
  /** Whether the transitions list replaces the role's (off = inherit). */
  transitionsOverridden: boolean;
  dealStageTransitions: string[];
}

/** Every schema resource present with an explicit scope (missing → All data). */
export function normalizeScopes(
  dataScope: DataScopeRules,
  schema: Schema,
): DataScopeRules {
  const out: DataScopeRules = {};
  for (const resource of Object.keys(schema)) {
    out[resource] = dataScope[resource] ?? DataScope.ALL;
  }
  return out;
}

/** Sparse matrix of cells where `effective` differs from `base`; undefined when none. */
export function diffMatrixSparse(
  effective: PermissionMatrix,
  base: PermissionMatrix,
  schema: Schema,
): PermissionMatrix | undefined {
  const out: PermissionMatrix = {};
  let any = false;
  for (const [resource, actions] of Object.entries(schema)) {
    for (const action of actions) {
      const value = isAllowed(effective, resource, action);
      if (value !== isAllowed(base, resource, action)) {
        (out[resource] ??= {})[action] = value;
        any = true;
      }
    }
  }
  return any ? out : undefined;
}

/** Sparse scope rules where `effective` differs from `base`; undefined when none. */
export function diffScopesSparse(
  effective: DataScopeRules,
  base: DataScopeRules,
  schema: Schema,
): DataScopeRules | undefined {
  const out: DataScopeRules = {};
  let any = false;
  for (const resource of Object.keys(schema)) {
    const value = effective[resource] ?? DataScope.ALL;
    if (value !== (base[resource] ?? DataScope.ALL)) {
      out[resource] = value;
      any = true;
    }
  }
  return any ? out : undefined;
}

/**
 * The sparse override object to PUT, or null when the draft matches the role
 * everywhere — the caller must then DELETE instead (an empty `{}` would be
 * stored and read back as "has overrides").
 */
export function buildOverrides(
  draft: OverridesDraft,
  role: Role,
  schema: Schema,
): UserPermissionOverrides | null {
  const permissions = diffMatrixSparse(draft.permissions, role.permissions, schema);
  const dataScope = diffScopesSparse(draft.dataScope, role.dataScope, schema);
  if (!permissions && !dataScope && !draft.transitionsOverridden) return null;
  return {
    ...(permissions ? { permissions } : {}),
    ...(dataScope ? { dataScope } : {}),
    ...(draft.transitionsOverridden
      ? { dealStageTransitions: [...draft.dealStageTransitions] }
      : {}),
  };
}

export interface OverrideSummary {
  permissionCells: number;
  scopeCells: number;
  transitionsOverridden: boolean;
  any: boolean;
}

/** Counts of a stored sparse override object, for badges and summaries. */
export function overrideSummary(overrides?: UserPermissionOverrides): OverrideSummary {
  const permissionCells = Object.values(overrides?.permissions ?? {}).reduce(
    (n, row) => n + Object.keys(row).length,
    0,
  );
  const scopeCells = Object.keys(overrides?.dataScope ?? {}).length;
  const transitionsOverridden = overrides?.dealStageTransitions !== undefined;
  return {
    permissionCells,
    scopeCells,
    transitionsOverridden,
    any: permissionCells > 0 || scopeCells > 0 || transitionsOverridden,
  };
}

/**
 * Whether stored overrides change anything against the role. A cell that
 * repeats the role's own answer, a scope equal to the role's, a transitions
 * list equal to the role's are overrides in storage only — the import gave
 * every dev user a copy of its role, and "Custom permissions" sat under
 * every name saying nothing (app_audit #26). Without the role in hand,
 * anything stored counts.
 */
export function overridesDiffer(overrides: UserPermissionOverrides | undefined, role: Role | undefined): boolean {
  if (!overrides) return false;
  if (!role) return overrideSummary(overrides).any;
  for (const [resource, row] of Object.entries(overrides.permissions ?? {})) {
    for (const [action, value] of Object.entries(row)) {
      if (value !== isAllowed(role.permissions, resource, action)) return true;
    }
  }
  for (const [resource, scope] of Object.entries(overrides.dataScope ?? {})) {
    if (scope !== (role.dataScope?.[resource] ?? DataScope.ALL)) return true;
  }
  if (overrides.dealStageTransitions !== undefined) {
    const theirs = [...overrides.dealStageTransitions].sort();
    const roles = [...(role.dealStageTransitions ?? [])].sort();
    if (theirs.length !== roles.length || theirs.some((t, i) => t !== roles[i])) return true;
  }
  return false;
}

/** Mirror of the backend's per-action merge (user wins) — round-trip checks. */
export function applyOverrides(
  base: PermissionMatrix,
  overrides?: PermissionMatrix,
): PermissionMatrix {
  const out: PermissionMatrix = {};
  for (const [resource, row] of Object.entries(base)) out[resource] = { ...row };
  for (const [resource, row] of Object.entries(overrides ?? {})) {
    out[resource] = { ...(out[resource] ?? {}), ...row };
  }
  return out;
}
