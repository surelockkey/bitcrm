import * as SecureStore from 'expo-secure-store';
import type { AuthTokens, StoredTokens } from './types';

const KEYS = {
  idToken: 'bitcrm.idToken',
  accessToken: 'bitcrm.accessToken',
  refreshToken: 'bitcrm.refreshToken',
} as const;

/**
 * The id token is also held in memory so the (synchronous) HTTP token provider
 * can read it without awaiting the keychain on every request.
 */
let idTokenCache: string | null = null;

export function getIdToken(): string | null {
  return idTokenCache;
}

export async function saveTokens(tokens: AuthTokens): Promise<void> {
  idTokenCache = tokens.idToken;
  await Promise.all([
    SecureStore.setItemAsync(KEYS.idToken, tokens.idToken),
    SecureStore.setItemAsync(KEYS.accessToken, tokens.accessToken),
    SecureStore.setItemAsync(KEYS.refreshToken, tokens.refreshToken),
  ]);
}

export async function loadTokens(): Promise<StoredTokens | null> {
  const [idToken, accessToken, refreshToken] = await Promise.all([
    SecureStore.getItemAsync(KEYS.idToken),
    SecureStore.getItemAsync(KEYS.accessToken),
    SecureStore.getItemAsync(KEYS.refreshToken),
  ]);

  if (!idToken || !accessToken || !refreshToken) {
    idTokenCache = null;
    return null;
  }

  idTokenCache = idToken;
  return { idToken, accessToken, refreshToken };
}

export async function clearTokens(): Promise<void> {
  idTokenCache = null;
  await Promise.all([
    SecureStore.deleteItemAsync(KEYS.idToken),
    SecureStore.deleteItemAsync(KEYS.accessToken),
    SecureStore.deleteItemAsync(KEYS.refreshToken),
  ]);
}
