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
  /**
   * Workiz's "Field team member": whether this person goes out on jobs and
   * may be put on one, whatever their role — an owner who still does calls
   * is on the field team; a technician who has moved into the office is not.
   * Absent on records from before the flag: read through
   * `isFieldTeamMember`, which falls back to the role.
   */
  fieldTeamMember?: boolean;
  status: UserStatus;
  permissionOverrides?: UserPermissionOverrides;
  createdAt: string;
  updatedAt: string;
}
