import type { UserType } from '../entities/user.entity';

export interface UpdateUserRequest {
  firstName?: string;
  lastName?: string;
  department?: string;
  /** Their own phone; empty string clears it. */
  phone?: string;
  /** Workiz "Field team member": on or off the roster that may be put on a job. */
  fieldTeamMember?: boolean;
  /**
   * Workiz "User type". To `subcontractor` takes the sign-in away at once;
   * back to `regular` gives it back and re-sends the invitation.
   */
  userType?: UserType;
}
