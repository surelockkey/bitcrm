export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  idToken: string;
  expiresIn: number;
}

export interface LoginChallengeResponse {
  challengeName: 'NEW_PASSWORD_REQUIRED';
  session: string;
}
