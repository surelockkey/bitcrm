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

/** What `POST /users/auth/refresh` returns — note: no new refresh token. */
export interface RefreshedTokens {
  idToken: string;
  accessToken: string;
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
 * Current user, as returned by `GET /users/me`
 * (`packages/types/src/entities/user.entity.ts`). `roleId` is what the app
 * resolves permissions from — there is no "my permissions" endpoint a
 * technician may call (docs/ARCHITECTURE.md §1.0). Kept permissive: fields the
 * phone does not read are carried through untouched.
 */
export interface AuthUser {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  roleId?: string;
  department?: string;
  phone?: string;
  status?: string;
  [key: string]: unknown;
}
