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
 * The account has two-step sign-in on (its own switch, or the account
 * requires it): a code has just been texted to `destination` (the masked
 * number). When the account lets the code go by email as well
 * (`SecuritySettings.loginCodeByEmail`), `emailDestination` names the
 * masked address `POST /users/auth/mfa/email` would send it to.
 */
export interface SmsMfaChallenge {
  challengeName: 'SMS_MFA';
  session: string;
  destination: string;
  emailDestination?: string;
}

/**
 * The account requires two-factor authentication and this person has no
 * phone to text: the tokens wait on the server until a phone is given
 * (`POST /users/auth/mfa/setup`) and the code texted to it comes back
 * (`POST /users/auth/mfa`). Workiz's "Set up two-factor authentication".
 */
export interface MfaSetupChallenge {
  challengeName: 'MFA_SETUP';
  session: string;
}

/**
 * The password was right but the sign-in is not done yet: either Cognito
 * wants a first password, or the account has two-step sign-in on and a code
 * has just been texted to it (`destination` is the masked number), or the
 * account requires it and a phone must be set up first.
 */
export type LoginChallengeResponse =
  | { challengeName: 'NEW_PASSWORD_REQUIRED'; session: string }
  | SmsMfaChallenge
  | MfaSetupChallenge;

/** `POST /users/auth/mfa` — the texted (or emailed) code, against the challenge it answers. */
export interface MfaVerifyRequest {
  session: string;
  code: string;
}

/** `POST /users/auth/mfa/setup` — the phone to text, for an `MFA_SETUP` challenge. */
export interface MfaSetupRequest {
  session: string;
  phone: string;
}

/** `POST /users/auth/mfa/email` — send this challenge's code to the account's email instead. */
export interface MfaEmailCodeRequest {
  session: string;
}
