import type {
  LoginRequest,
  LoginResponse,
  LoginChallengeResponse,
  ChangePasswordRequest,
  ChangePasswordResponse,
  RefreshTokenResponse,
  MfaVerifyRequest,
  MfaSetupRequest,
} from "@bitcrm/types";
import { http } from "@/lib/api/http";

export function login(
  body: LoginRequest,
): Promise<LoginResponse | LoginChallengeResponse> {
  return http.post("/users/auth/login", body);
}

/** Trade the refresh token for a fresh id token. Public endpoint — no Bearer. */
export function refreshSession(
  refreshToken: string,
): Promise<RefreshTokenResponse> {
  return http.post("/users/auth/refresh", { refreshToken });
}

/** Two-step sign-in: the texted code, traded for the tokens the password earned. */
export function verifyMfa(body: MfaVerifyRequest): Promise<LoginResponse> {
  return http.post("/users/auth/mfa", body);
}

/** Text the two-step sign-in code again, to the same phone. */
export function resendMfa(session: string): Promise<{ destination: string }> {
  return http.post("/users/auth/mfa/resend", { session });
}

/**
 * The account requires two-factor authentication and this person had no
 * phone (`MFA_SETUP`): the phone to text — its code then finishes the sign-in.
 */
export function setupMfa(body: MfaSetupRequest): Promise<{ destination: string }> {
  return http.post("/users/auth/mfa/setup", body);
}

/** The sign-in code to the account's email instead (Security Center "Login sending options"). */
export function emailMfaCode(session: string): Promise<{ destination: string }> {
  return http.post("/users/auth/mfa/email", { session });
}

export function setNewPassword(
  body: ChangePasswordRequest,
): Promise<ChangePasswordResponse | LoginChallengeResponse> {
  return http.post("/users/auth/change-password", body);
}

export function requestPasswordReset(
  email: string,
): Promise<{ message: string }> {
  return http.post("/users/auth/password-reset", { email });
}

export function confirmPasswordReset(body: {
  email: string;
  code: string;
  newPassword: string;
}): Promise<{ message: string }> {
  return http.post("/users/auth/password-reset/confirm", body);
}

/** Narrows a login response to a challenge — a first password, or a texted code. */
export function isChallenge(
  res: LoginResponse | ChangePasswordResponse | LoginChallengeResponse,
): res is LoginChallengeResponse {
  return "challengeName" in res;
}
