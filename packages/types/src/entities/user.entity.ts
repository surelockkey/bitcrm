import { UserStatus } from '../enums/user-status.enum';
import { UserPermissionOverrides } from '../permissions/permission-matrix';

export interface User {
  id: string;
  cognitoSub: string;
  email: string;
  firstName: string;
  lastName: string;
  /**
   * The person's whole name as Workiz printed it — "(2) TX - Daniel Munoz",
   * group and region prefix included — kept by the Workiz import beside the
   * split `firstName` / `lastName` ("Daniel" / "Munoz"). Workiz shows exactly
   * this on every tech chip, so screens that mirror Workiz print
   * `workizName ?? \`${firstName} ${lastName}\``.
   *
   * Read-only: absent on anyone created here, and dropped by user-service the
   * moment the person is renamed here (it would no longer name them).
   */
  workizName?: string;
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
  /**
   * Two-step sign-in: after the password, a code texted to `phone` (Twilio
   * Verify). Only ever switched on once that number has proved it receives
   * texts; changing the number switches it off until the new one does.
   */
  smsMfaEnabled?: boolean;
  status: UserStatus;
  permissionOverrides?: UserPermissionOverrides;
  createdAt: string;
  updatedAt: string;
}
