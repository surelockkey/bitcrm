import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * "Location Tracking" — the switch Workiz puts in Settings (§1.12), kept where
 * the profile is kept: on the phone, per technician.
 *
 * Per technician because a van's phone gets handed over, and one technician's
 * decision about being followed is not the next one's. It is a preference, not
 * a secret, so it sits in AsyncStorage beside `bitcrm.profile.v1` rather than
 * in the keychain.
 *
 * **Default on.** The clock and the position are one feature for the office —
 * 99% of the 15 277 timeclock rows in the Workiz export carry coordinates
 * (§1.7), so a technician who clocks in is expected to be on the map. What
 * makes that defensible rather than sneaky is the rest of the design: nothing
 * is sent until they are on the clock, the explainer says who wants it and why
 * before the phone ever asks, and this switch stops it for good.
 */

const KEY_PREFIX = 'bitcrm.location.sharing.v1.';

const keyFor = (userId: string) => `${KEY_PREFIX}${userId}`;

export const DEFAULT_SHARING_ENABLED = true;

export async function loadSharingPreference(userId: string): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(keyFor(userId));
    if (raw === null) return DEFAULT_SHARING_ENABLED;
    return raw === 'true';
  } catch {
    // A storage that will not answer must not decide this either way by
    // accident; the documented default is the honest fallback.
    return DEFAULT_SHARING_ENABLED;
  }
}

export async function saveSharingPreference(
  userId: string,
  enabled: boolean,
): Promise<void> {
  try {
    await AsyncStorage.setItem(keyFor(userId), String(enabled));
  } catch {
    // Turning it off has already stopped the watcher in memory. Failing to
    // remember that across a restart is bad, but it must not throw in the
    // middle of a technician switching it off.
  }
}
