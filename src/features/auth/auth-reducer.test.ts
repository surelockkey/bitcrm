import { authReducer, initialAuthState, type AuthState } from './auth-reducer';

const user = { id: '1', email: 'tech@slk-s.com' };

describe('authReducer', () => {
  it('starts in the loading state', () => {
    expect(initialAuthState).toEqual({ status: 'loading' });
  });

  it('restores an existing session', () => {
    expect(authReducer(initialAuthState, { type: 'restored', user })).toEqual({
      status: 'signedIn',
      user,
    });
  });

  it('falls back to signedOut when there is no session', () => {
    expect(authReducer(initialAuthState, { type: 'noSession' })).toEqual({
      status: 'signedOut',
    });
  });

  it('clears any prior error when a sign-in attempt starts', () => {
    const errored: AuthState = { status: 'signedOut', error: 'Bad creds' };
    expect(authReducer(errored, { type: 'signInStart' })).toEqual({
      status: 'signedOut',
    });
  });

  it('signs in on success', () => {
    const start: AuthState = { status: 'signedOut' };
    expect(authReducer(start, { type: 'signInSuccess', user })).toEqual({
      status: 'signedIn',
      user,
    });
  });

  it('records the error message on a failed sign-in', () => {
    const start: AuthState = { status: 'signedOut' };
    expect(
      authReducer(start, { type: 'signInError', error: 'Invalid password' }),
    ).toEqual({ status: 'signedOut', error: 'Invalid password' });
  });

  it('signs out from a signed-in state', () => {
    const signedIn: AuthState = { status: 'signedIn', user };
    expect(authReducer(signedIn, { type: 'signOut' })).toEqual({
      status: 'signedOut',
    });
  });
});
