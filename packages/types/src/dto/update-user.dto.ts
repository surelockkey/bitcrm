export interface UpdateUserRequest {
  firstName?: string;
  lastName?: string;
  department?: string;
  /** Their own phone; empty string clears it. */
  phone?: string;
}
