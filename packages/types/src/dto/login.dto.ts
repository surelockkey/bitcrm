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

/**
 * The password was right but the sign-in is not done yet: either Cognito
 * wants a first password, or the account has two-step sign-in on and a code
 * has just been texted to it (`destination` is the masked number).
 */
export type LoginChallengeResponse =
  | { challengeName: 'NEW_PASSWORD_REQUIRED'; session: string }
  | { challengeName: 'SMS_MFA'; session: string; destination: string };

/** `POST /users/auth/mfa` — the texted code, against the challenge it answers. */
export interface MfaVerifyRequest {
  session: string;
  code: string;
}
