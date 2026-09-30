import { UserStatus } from '../enums/user-status.enum';

export interface ListUsersQuery {
  roleId?: string;
  department?: string;
  status?: UserStatus;
  /** Case-insensitive "contains" over first name, last name, full name and email. */
  search?: string;
  limit?: number;
  cursor?: string;
}
