import type { UserType } from '../entities/user.entity';

export interface CreateUserRequest {
  email: string;
  firstName: string;
  lastName: string;
  /** Required for a User; ignored for a subcontractor (always the technician role). */
  roleId?: string;
  department: string;
  /** Their own phone, any format — stored E.164. Optional. */
  phone?: string;
  /**
   * Workiz "User type" (Add team member → User | Subcontractor). Omitted = a
   * User, invited by email. A `subcontractor` gets no invitation and cannot
   * sign in; they join the field team.
   */
  userType?: UserType;
}
