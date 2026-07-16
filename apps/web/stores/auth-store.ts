import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { LoginResponse, ChangePasswordResponse } from "@bitcrm/types";

/**
 * Client-side auth/session state.
 *
 * NOTE: the API authenticates with the Cognito **id token** as the Bearer.
 * v1 persists tokens to localStorage for simplicity; the planned hardening is
 * to move them into httpOnly cookies behind a Next route handler.
 */
export interface AuthSession {
  idToken: string;
  accessToken: string;
  refreshToken: string;
  /** Access-token lifetime in seconds, as returned by Cognito. */
  expiresIn: number;
  /** Epoch ms when the session was stored (for refresh scheduling). */
  obtainedAt: number;
}

/** LoginResponse and ChangePasswordResponse are the same token shape. */
type TokenPayload = LoginResponse | ChangePasswordResponse;

interface AuthState {
  session: AuthSession | null;
  /**
   * Carried from a first-login (NEW_PASSWORD_REQUIRED) redirect so the
   * set-password screen can answer the challenge without asking again:
   *  - pendingEmail    → the account being set up
   *  - challengeSession → the Cognito session returned by the login challenge
   * (Cognito sessions are short-lived, but set-password immediately follows login.)
   */
  pendingEmail: string | null;
  challengeSession: string | null;
  setSession: (tokens: TokenPayload) => void;
  setChallenge: (email: string, session: string) => void;
  clear: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      session: null,
      pendingEmail: null,
      challengeSession: null,
      setSession: (tokens) =>
        set({
          session: {
            idToken: tokens.idToken,
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            expiresIn: tokens.expiresIn,
            obtainedAt: Date.now(),
          },
          pendingEmail: null,
          challengeSession: null,
        }),
      setChallenge: (pendingEmail, challengeSession) =>
        set({ pendingEmail, challengeSession }),
      clear: () =>
        set({ session: null, pendingEmail: null, challengeSession: null }),
    }),
    { name: "bitcrm.auth" },
  ),
);

/** Non-reactive accessor used by the API client to attach the Bearer token. */
export const getIdToken = (): string | null =>
  useAuthStore.getState().session?.idToken ?? null;
