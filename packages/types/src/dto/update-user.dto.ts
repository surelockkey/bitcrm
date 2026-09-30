export interface UpdateUserRequest {
  firstName?: string;
  lastName?: string;
  department?: string;
  /** Their own phone; empty string clears it. */
  phone?: string;
  /** Workiz "Field team member": on or off the roster that may be put on a job. */
  fieldTeamMember?: boolean;
}
