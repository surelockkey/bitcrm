import { http } from '../../lib/api/http';
import type {
  AuthUser,
  LoginRequest,
  LoginResult,
  RefreshedTokens,
} from './types';

export function login(body: LoginRequest): Promise<LoginResult> {
  return http.post<LoginResult>('/users/auth/login', body);
}

export function getMe(): Promise<AuthUser> {
  return http.get<AuthUser>('/users/me');
}

/**
 * Exchange the refresh token for a new id token.
 *
 * Sent with `postWithoutRefresh` so a 401 here cannot ask the client to refresh
 * again — this is the one request in the app where a 401 genuinely means the
 * session is over.
 */
export function refresh(refreshToken: string): Promise<RefreshedTokens> {
  return http.postWithoutRefresh<RefreshedTokens>('/users/auth/refresh', {
    refreshToken,
  });
}
