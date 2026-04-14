import { DataScopeRules, PermissionMatrix } from '../permissions/permission-matrix';

export interface Role {
  id: string;
  name: string;
  description?: string;
  /** resource → action → boolean (deny-by-default) */
  permissions: PermissionMatrix;
  /** resource → DataScope for data visibility filtering */
  dataScope: DataScopeRules;
  /** Allowed stage transitions, e.g. ["lead->qualified", "*->canceled"] */
  dealStageTransitions: string[];
  /** True for seeded system roles (Super Admin is immutable) */
  isSystem: boolean;
  /** Numeric priority for hierarchy comparison (higher = more powerful) */
  priority: number;
  createdAt: string;
  updatedAt: string;
}
