import { UserPermissionOverrides } from '../permissions/permission-matrix';

export interface UpdateUserPermissionsRequest {
  overrides: UserPermissionOverrides;
}
