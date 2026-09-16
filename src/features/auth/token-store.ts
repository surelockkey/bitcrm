import * as SecureStore from 'expo-secure-store';
import type { AuthTokens, RefreshedTokens, StoredTokens } from './types';

const KEYS = {
  idToken: 'bitcrm.idToken',
  accessToken: 'bitcrm.accessToken',
  refreshToken: 'bitcrm.refreshToken',
} as const;

/**
 * The id and refresh tokens are also held in memory: the HTTP token provider is
 * synchronous, and a refresh has to happen inside a failing request without
 * awaiting the keychain first.
 */
let idTokenCache: string | null = null;
let refreshTokenCache: string | null = null;

export function getIdToken(): string | null {
  return idTokenCache;
}

export function getRefreshToken(): string | null {
  return refreshTokenCache;
}

export async function saveTokens(tokens: AuthTokens): Promise<void> {
  idTokenCache = tokens.idToken;
  refreshTokenCache = tokens.refreshToken;
  await Promise.all([
    SecureStore.setItemAsync(KEYS.idToken, tokens.idToken),
    SecureStore.setItemAsync(KEYS.accessToken, tokens.accessToken),
    SecureStore.setItemAsync(KEYS.refreshToken, tokens.refreshToken),
  ]);
}

/**
 * Store the result of a refresh. Cognito's refresh response carries no new
 * refresh token, so the existing one is deliberately left where it is.
 */
export async function saveRefreshedTokens(
  tokens: RefreshedTokens,
): Promise<void> {
  idTokenCache = tokens.idToken;
  await Promise.all([
    SecureStore.setItemAsync(KEYS.idToken, tokens.idToken),
    SecureStore.setItemAsync(KEYS.accessToken, tokens.accessToken),
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
    refreshTokenCache = null;
    return null;
  }

  idTokenCache = idToken;
  refreshTokenCache = refreshToken;
  return { idToken, accessToken, refreshToken };
}

export async function clearTokens(): Promise<void> {
  idTokenCache = null;
  refreshTokenCache = null;
  await Promise.all([
    SecureStore.deleteItemAsync(KEYS.idToken),
    SecureStore.deleteItemAsync(KEYS.accessToken),
    SecureStore.deleteItemAsync(KEYS.refreshToken),
  ]);
}
