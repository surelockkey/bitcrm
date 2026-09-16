/** Auth contract, mirrored from the backend `@bitcrm/types` package. */

export interface LoginRequest {
  email: string;
  password: string;
}

/** Successful Cognito login. The backend authenticates with `idToken`. */
export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  idToken: string;
  expiresIn: number;
}

/** The three tokens we persist (no `expiresIn` — it's transient). */
export interface StoredTokens {
  accessToken: string;
  refreshToken: string;
  idToken: string;
}

/** First-login challenge — the user must set a password on the web app first. */
export interface LoginChallenge {
  challengeName: 'NEW_PASSWORD_REQUIRED';
  session: string;
}

export type LoginResult = AuthTokens | LoginChallenge;

export function isChallenge(result: LoginResult): result is LoginChallenge {
  return 'challengeName' in result;
}

/**
 * Current user, as returned by `GET /users/me`. Kept permissive: this test
 * app only displays identity to prove the session works.
 */
export interface AuthUser {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  role?: string;
  [key: string]: unknown;
}
