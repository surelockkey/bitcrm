import { PermissionMatrix, DataScopeRules } from './permission-matrix';

/** Fully resolved permissions for a user — role base merged with per-user overrides */
export interface ResolvedPermissions {
  roleId: string;
  roleName: string;
  isSystemRole: boolean;
  /** Merged: role base + user overrides (user wins) */
  permissions: PermissionMatrix;
  /** Merged: role base + user overrides (user wins) */
  dataScope: DataScopeRules;
  /** User override if set, otherwise role default */
  dealStageTransitions: string[];
  /** True if the user has any per-user overrides */
  hasOverrides: boolean;
}
