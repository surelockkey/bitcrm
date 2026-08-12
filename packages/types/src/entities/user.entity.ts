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
  /**
   * Their own phone, E.164. Calls to or from it are recognised as reaching
   * that person directly rather than an unknown caller — see the call log.
   */
  phone?: string;
  status: UserStatus;
  permissionOverrides?: UserPermissionOverrides;
  createdAt: string;
  updatedAt: string;
}
