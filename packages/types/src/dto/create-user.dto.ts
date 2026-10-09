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
   * Workiz "Field tech — Can this user be assigned to jobs". Omitted = by
   * role (a technician is, nobody else). Ignored for a subcontractor, who is
   * always on the field team.
   */
  fieldTeamMember?: boolean;
  /**
   * Workiz "Track Location": the technician card a field team member gets
   * starts with location tracking on. Nothing without a card; never for a
   * subcontractor (no app to track).
   */
  gpsTrackingEnabled?: boolean;
  /**
   * Workiz "User type" (Add team member → User | Subcontractor). Omitted = a
   * User, invited by email. A `subcontractor` gets no invitation and cannot
   * sign in; they join the field team.
   */
  userType?: UserType;
}
