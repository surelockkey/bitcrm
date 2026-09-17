import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useReducer,
  useState,
} from 'react';
import {
  setAuthTokenProvider,
  setTokenRefresher,
  setUnauthorizedHandler,
} from '../../lib/api/http';
import { ApiError } from '../../lib/api/errors';
import { resetAppCache } from '../../lib/query/client';
import { releasePushDevice } from '../notifications/device';
import { authReducer, initialAuthState, type AuthState } from './auth-reducer';
import { getMe, login as loginApi, refresh as refreshApi } from './api';
import { clearProfile, loadProfile, saveProfile } from './profile-store';
import {
  clearTokens,
  getIdToken,
  getRefreshToken,
  loadTokens,
  saveRefreshedTokens,
  saveTokens,
} from './token-store';
import { isChallenge } from './types';

interface AuthContextValue {
  state: AuthState;
  /** True while a sign-in request is in flight. */
  submitting: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Renew the session in place. Handed to the HTTP layer, which calls it on a
 * 401 and retries the request once if it succeeds — a shift outlives an id
 * token, and being bounced to login mid-job is the worst possible moment
 * (docs/ARCHITECTURE.md §2.5).
 */
async function renewSession(): Promise<boolean> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return false;
  try {
    const tokens = await refreshApi(refreshToken);
    await saveRefreshedTokens(tokens);
    return true;
  } catch {
    return false;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(authReducer, initialAuthState);
  const [submitting, setSubmitting] = useState(false);

  const signOut = useCallback(async () => {
    // Before the tokens go, not after: taking this phone off the push list is
    // an authenticated call, and a moment later there is no session to make it
    // with. Guarded all the same — nothing about saying goodbye may be able to
    // trap a technician inside a session they have asked to leave, so a
    // basement, or a server that has already forgotten the token, costs a
    // stale row the server prunes when a push to it bounces.
    await releasePushDevice().catch(() => {});
    await clearTokens();
    // The van's phone gets handed over. Nothing about the last technician —
    // their route, their clients' addresses — may survive into the next session.
    await Promise.all([clearProfile(), resetAppCache()]);
    dispatch({ type: 'signOut' });
  }, []);

  // Wire the HTTP layer to our token store, then restore any saved session.
  useEffect(() => {
    setAuthTokenProvider(getIdToken);
    setTokenRefresher(renewSession);
    setUnauthorizedHandler(() => {
      void signOut();
    });

    void (async () => {
      const stored = await loadTokens();
      if (!stored) {
        dispatch({ type: 'noSession' });
        return;
      }
      try {
        const user = await getMe();
        void saveProfile(user);
        dispatch({ type: 'restored', user });
      } catch (err) {
        // Only the server refusing the session ends it. A technician who opens
        // the app with no signal keeps their session — and their cached day —
        // on the strength of the profile last written to disk; a dead network
        // is not a sign-out.
        if (err instanceof ApiError && err.status === 0) {
          const cached = await loadProfile();
          if (cached) {
            dispatch({ type: 'restored', user: cached });
            return;
          }
        }
        await clearTokens();
        await clearProfile();
        dispatch({ type: 'noSession' });
      }
    })();
  }, [signOut]);

  const signIn = useCallback(async (email: string, password: string) => {
    setSubmitting(true);
    dispatch({ type: 'signInStart' });
    try {
      const result = await loginApi({ email: email.trim(), password });
      if (isChallenge(result)) {
        dispatch({
          type: 'signInError',
          error:
            'This account must set its password on the web app before signing in.',
        });
        return;
      }
      await saveTokens(result);
      const user = await getMe();
      await saveProfile(user);
      dispatch({ type: 'signInSuccess', user });
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : 'Something went wrong. Please try again.';
      dispatch({ type: 'signInError', error: message });
    } finally {
      setSubmitting(false);
    }
  }, []);

  return (
    <AuthContext.Provider value={{ state, submitting, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
