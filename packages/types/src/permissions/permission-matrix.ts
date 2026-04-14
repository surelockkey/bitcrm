import { DataScope } from '../enums/data-scope.enum';

/** resource → action → boolean (deny-by-default) */
export type PermissionMatrix = Record<string, Record<string, boolean>>;

/** resource → DataScope */
export type DataScopeRules = Record<string, DataScope>;

/**
 * Sparse overrides stored on the user item.
 * Only contains keys that differ from the role's base permissions.
 */
export interface UserPermissionOverrides {
  /** Sparse — only overridden resource.action pairs */
  permissions?: PermissionMatrix;
  /** Sparse — only overridden resources */
  dataScope?: DataScopeRules;
  /** If set, fully replaces the role's stage transitions */
  dealStageTransitions?: string[];
}
