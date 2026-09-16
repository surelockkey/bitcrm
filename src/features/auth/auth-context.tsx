import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useReducer,
  useState,
} from 'react';
import { setAuthTokenProvider, setUnauthorizedHandler } from '../../lib/api/http';
import { ApiError } from '../../lib/api/errors';
import { authReducer, initialAuthState, type AuthState } from './auth-reducer';
import { getMe, login as loginApi } from './api';
import {
  clearTokens,
  getIdToken,
  loadTokens,
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

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(authReducer, initialAuthState);
  const [submitting, setSubmitting] = useState(false);

  const signOut = useCallback(async () => {
    await clearTokens();
    dispatch({ type: 'signOut' });
  }, []);

  // Wire the HTTP layer to our token store, then restore any saved session.
  useEffect(() => {
    setAuthTokenProvider(getIdToken);
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
        dispatch({ type: 'restored', user });
      } catch {
        await clearTokens();
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
