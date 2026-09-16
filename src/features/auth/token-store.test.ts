import * as SecureStore from 'expo-secure-store';
import {
  clearTokens,
  getIdToken,
  loadTokens,
  saveTokens,
} from './token-store';
import type { AuthTokens } from './types';

const tokens: AuthTokens = {
  idToken: 'ID_1',
  accessToken: 'ACCESS_1',
  refreshToken: 'REFRESH_1',
  expiresIn: 3600,
};

describe('token-store', () => {
  // Reset the module-level id-token cache between cases (the keychain itself is
  // cleared by the global setup's beforeEach).
  beforeEach(async () => {
    await clearTokens();
  });

  it('round-trips the three tokens through secure storage', async () => {
    await saveTokens(tokens);
    await expect(loadTokens()).resolves.toEqual({
      idToken: 'ID_1',
      accessToken: 'ACCESS_1',
      refreshToken: 'REFRESH_1',
    });
  });

  it('exposes the id token synchronously after saving (for the http provider)', async () => {
    expect(getIdToken()).toBeNull();
    await saveTokens(tokens);
    expect(getIdToken()).toBe('ID_1');
  });

  it('returns null when no session is stored', async () => {
    await expect(loadTokens()).resolves.toBeNull();
  });

  it('primes the in-memory id token from storage on load', async () => {
    await SecureStore.setItemAsync('bitcrm.idToken', 'ID_FROM_DISK');
    await SecureStore.setItemAsync('bitcrm.accessToken', 'A');
    await SecureStore.setItemAsync('bitcrm.refreshToken', 'R');
    await loadTokens();
    expect(getIdToken()).toBe('ID_FROM_DISK');
  });

  it('clears both storage and the in-memory token', async () => {
    await saveTokens(tokens);
    await clearTokens();
    expect(getIdToken()).toBeNull();
    await expect(loadTokens()).resolves.toBeNull();
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('bitcrm.idToken');
  });

  it('does not persist expiresIn (transient value)', async () => {
    await saveTokens(tokens);
    const keysWritten = (SecureStore.setItemAsync as jest.Mock).mock.calls.map(
      (c) => c[0],
    );
    expect(keysWritten).toEqual(
      expect.arrayContaining([
        'bitcrm.idToken',
        'bitcrm.accessToken',
        'bitcrm.refreshToken',
      ]),
    );
    expect(keysWritten).not.toContain('bitcrm.expiresIn');
  });
});
