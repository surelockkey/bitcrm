export interface CreateUserRequest {
  email: string;
  firstName: string;
  lastName: string;
  roleId: string;
  department: string;
  /** Their own phone, any format — stored E.164. Optional. */
  phone?: string;
}
