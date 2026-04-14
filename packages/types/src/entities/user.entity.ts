import { UserStatus } from '../enums/user-status.enum';
import { UserPermissionOverrides } from '../permissions/permission-matrix';

export interface User {
  id: string;
  cognitoSub: string;
  email: string;
  firstName: string;
  lastName: string;
  roleId: string;
  department: string;
  status: UserStatus;
  permissionOverrides?: UserPermissionOverrides;
  createdAt: string;
  updatedAt: string;
}
