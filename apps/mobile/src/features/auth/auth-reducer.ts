import type { AuthUser } from './types';

export type AuthState =
  | { status: 'loading' }
  | { status: 'signedOut'; error?: string }
  | { status: 'signedIn'; user: AuthUser };

export type AuthAction =
  | { type: 'restored'; user: AuthUser }
  | { type: 'noSession' }
  | { type: 'signInStart' }
  | { type: 'signInSuccess'; user: AuthUser }
  | { type: 'signInError'; error: string }
  | { type: 'signOut' };

export const initialAuthState: AuthState = { status: 'loading' };

export function authReducer(state: AuthState, action: AuthAction): AuthState {
  switch (action.type) {
    case 'restored':
    case 'signInSuccess':
      return { status: 'signedIn', user: action.user };
    case 'noSession':
    case 'signInStart':
    case 'signOut':
      return { status: 'signedOut' };
    case 'signInError':
      return { status: 'signedOut', error: action.error };
    default:
      return state;
  }
}
