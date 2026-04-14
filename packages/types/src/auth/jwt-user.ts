export interface JwtUser {
  id: string;
  cognitoSub: string;
  email: string;
  roleId: string;
  department: string;
}
