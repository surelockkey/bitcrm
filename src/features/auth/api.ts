import { http } from '../../lib/api/http';
import type { AuthUser, LoginRequest, LoginResult } from './types';

export function login(body: LoginRequest): Promise<LoginResult> {
  return http.post<LoginResult>('/users/auth/login', body);
}

export function getMe(): Promise<AuthUser> {
  return http.get<AuthUser>('/users/me');
}

export function refresh(
  refreshToken: string,
): Promise<{ idToken: string; accessToken: string; expiresIn: number }> {
  return http.post('/users/auth/refresh', { refreshToken });
}
