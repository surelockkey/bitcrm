import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AuthUser } from './types';

const KEY = 'bitcrm.profile.v1';

/**
 * The signed-in technician's profile, kept on disk.
 *
 * Tokens live in the keychain; this is the identity behind them, and it is
 * here for one reason: a technician who opens the app with no signal must land
 * on their day, not on the login screen. `GET /users/me` cannot answer in a
 * basement, so the last known answer stands in until the network returns
 * (docs/ARCHITECTURE.md §2.3).
 *
 * Nothing secret goes in here — a name, an email, a role id. The credentials
 * that make it usable are in `expo-secure-store`.
 */
export async function saveProfile(user: AuthUser): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(user));
  } catch {
    // A full disk must not break signing in.
  }
}

export async function loadProfile(): Promise<AuthUser | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    // A half-written or outdated blob is worse than nothing: without an id the
    // jobs query would ask the server for the whole dispatch board.
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as AuthUser).id === 'string' &&
      typeof (parsed as AuthUser).email === 'string'
    ) {
      return parsed as AuthUser;
    }
    return null;
  } catch {
    return null;
  }
}

export async function clearProfile(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    // Signing out must not be blocked by storage.
  }
}
