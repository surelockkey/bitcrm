export interface ChangePasswordRequest {
  email: string;
  newPassword: string;
  session: string;
}

export interface ChangePasswordResponse {
  accessToken: string;
  refreshToken: string;
  idToken: string;
  expiresIn: number;
}
