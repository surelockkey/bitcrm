import { Linking } from 'react-native';
import * as Location from 'expo-location';
import { GEOLOCATION_TIMEOUT_MS, toFix, type Fix } from '../jobs/location';

/**
 * The phone's side of location sharing.
 *
 * Foreground ("while using the app") permission only, which is also the limit
 * Workiz itself works within: "Workiz will only track a user's location while
 * the app is open on the device" (`WORKIZ_MOBILE_APP.md` §1.12, quoted from
 * their help centre). Tracking with the app closed needs `Always` on iOS and a
 * foreground service plus `ACCESS_BACKGROUND_LOCATION` on Android, and both of
 * those need an owner account and a store declaration this project does not
 * have yet (`WORKIZ_MOBILE_APP.md` §3, wave v3, marked 🔑). Sending from the
 * background without them is what the app deliberately does not do.
 */

export type LocationPermission =
  /** Asked and allowed. */
  | 'granted'
  /** Asked and refused — only the phone's own Settings can undo it. */
  | 'denied'
  /** Never asked. The explainer comes first. */
  | 'undetermined';

function read(result: {
  granted: boolean;
  canAskAgain: boolean;
}): LocationPermission {
  if (result.granted) return 'granted';
  return result.canAskAgain ? 'undetermined' : 'denied';
}

/** What the phone already thinks, without prompting anybody. */
export async function getLocationPermission(): Promise<LocationPermission> {
  try {
    return read(await Location.getForegroundPermissionsAsync());
  } catch {
    // A phone with no location services at all answers the same way a refusal
    // does, and for every caller here that is the same thing: no fix.
    return 'denied';
  }
}

/**
 * Show the OS prompt. Only ever called after our own one-sentence explanation —
 * the system dialog cannot say who wants the location or why, and it can only
 * be shown once.
 */
export async function requestLocationPermission(): Promise<LocationPermission> {
  try {
    return read(await Location.requestForegroundPermissionsAsync());
  } catch {
    return 'denied';
  }
}

/** The phone's own settings page, for a technician who said no and changed their mind. */
export async function openPhoneSettings(): Promise<boolean> {
  try {
    await Linking.openSettings();
    return true;
  } catch {
    return false;
  }
}

/**
 * A fix for a clock-in or clock-out — **only if permission is already given**.
 *
 * Deliberately different from `jobs/location.ts#currentPosition`, which asks.
 * Clocking in must never be the moment a system dialog appears: the technician
 * is being asked to hand their employer their position, and that question
 * belongs on the screen that explains it, not on top of the button that starts
 * their shift. No permission here simply means no coordinates, and the entry is
 * recorded without them.
 */
export async function currentPositionIfPermitted(): Promise<Fix | undefined> {
  try {
    if ((await getLocationPermission()) !== 'granted') return undefined;

    const timeout = new Promise<undefined>((resolve) => {
      setTimeout(() => resolve(undefined), GEOLOCATION_TIMEOUT_MS);
    });
    const reading = Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    })
      .then((position) => toFix(position.coords))
      // Attached to the reading rather than to the race: once the timeout wins,
      // a rejection arriving later would have no handler at all, and React
      // Native reports that as an unhandled rejection (`jobs/location.ts`).
      .catch(() => undefined);

    return await Promise.race([reading, timeout]);
  } catch {
    return undefined;
  }
}
