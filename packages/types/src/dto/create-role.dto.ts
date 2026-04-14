import { DataScopeRules, PermissionMatrix } from '../permissions/permission-matrix';

export interface CreateRoleRequest {
  name: string;
  description?: string;
  permissions: PermissionMatrix;
  dataScope: DataScopeRules;
  dealStageTransitions: string[];
  priority: number;
}
