import type {
  LoginRequest,
  LoginResponse,
  LoginChallengeResponse,
  ChangePasswordRequest,
  ChangePasswordResponse,
  RefreshTokenResponse,
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

export function setNewPassword(
  body: ChangePasswordRequest,
): Promise<ChangePasswordResponse> {
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

/** Narrows a login response to the first-login challenge. */
export function isChallenge(
  res: LoginResponse | LoginChallengeResponse,
): res is LoginChallengeResponse {
  return "challengeName" in res;
}
