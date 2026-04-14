import { UserStatus } from '../enums/user-status.enum';

export interface ListUsersQuery {
  roleId?: string;
  department?: string;
  status?: UserStatus;
  limit?: number;
  cursor?: string;
}
