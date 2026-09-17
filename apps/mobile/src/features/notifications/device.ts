import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { registerDevice, unregisterDevice } from './api';
import { permissionDecision } from './policy';
import { loadPushState, recordAppOpen, savePushState } from './store';
import type { DevicePlatform, RegistrationOutcome } from './types';

/**
 * Getting this phone onto — and off — the push list.
 *
 * Every step of it can fail in a way that is nobody's fault, and the rule for
 * all of them is the same: **the app keeps working**. Push is the one feature
 * here that cannot be finished yet — remote delivery needs a development
 * build, an APNs key and an FCM project, and the owner's Apple and Google
 * accounts do not exist. So this returns a value describing what happened
 * rather than throwing, nothing it does blocks a screen, and no branch shows a
 * technician a dialog. A technician whose phone cannot hold a push token has
 * an app that behaves exactly as it does today.
 */

/**
 * The Expo project this build belongs to — Expo mints push tokens against it.
 *
 * Absent today, and that is not a bug: it arrives in `app.json` with the
 * owner's Expo account. Until then `getExpoPushTokenAsync` would throw, so the
 * app does not call it.
 */
export function easProjectId(): string | undefined {
  const extra = Constants.expoConfig?.extra as
    | { eas?: { projectId?: unknown } }
    | undefined;
  const id = extra?.eas?.projectId;
  return typeof id === 'string' && id ? id : undefined;
}

function devicePlatform(): DevicePlatform | null {
  return Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : null;
}

/**
 * Android shows nothing at all for a notification that has no channel. Made at
 * startup rather than on first delivery, because the first delivery is exactly
 * when getting it wrong is invisible.
 */
export async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Jobs and messages',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  } catch {
    // A channel that could not be created costs a notification, not a launch.
  }
}

/**
 * Ask for permission if this is the moment to, then hand the server a token.
 *
 * Called on every signed-in open. Registering an unchanged token again is
 * deliberate — it is how the server learns this phone is still in service and
 * gets to drop the ones that are not.
 */
export async function registerPushDevice(): Promise<RegistrationOutcome> {
  const platform = devicePlatform();
  // Web, and anything else Expo grows: no device token to speak of.
  if (!platform) return { status: 'unavailable', reason: 'no-token' };

  // A simulator has no push token because there is no device to push to. This
  // is where every developer's first run lands, and it must be silent.
  if (!Device.isDevice) return { status: 'unavailable', reason: 'simulator' };

  const opens = await recordAppOpen();
  const state = await loadPushState();

  let permission: Notifications.NotificationPermissionsStatus;
  try {
    permission = await Notifications.getPermissionsAsync();
  } catch (error) {
    return { status: 'failed', error };
  }

  const decision = permissionDecision({
    opens,
    alreadyAsked: state.asked,
    permission: { granted: permission.granted, canAskAgain: permission.canAskAgain },
  });

  if (decision === 'wait') return { status: 'not-yet' };
  if (decision === 'never') return { status: 'denied' };

  if (decision === 'ask') {
    // Remember that we asked *before* the prompt resolves. A technician who
    // kills the app on top of the dialog has still been asked, and must not
    // meet it again on their next open.
    await savePushState({ asked: true });
    try {
      const asked = await Notifications.requestPermissionsAsync();
      if (!asked.granted) return { status: 'denied' };
    } catch (error) {
      return { status: 'failed', error };
    }
  }

  const projectId = easProjectId();
  if (!projectId) return { status: 'unavailable', reason: 'no-project-id' };

  let token: string;
  try {
    // Throws in Expo Go, and in any build whose credentials do not exist yet.
    const minted = await Notifications.getExpoPushTokenAsync({ projectId });
    token = minted.data;
  } catch {
    return { status: 'unavailable', reason: 'no-token' };
  }
  if (!token) return { status: 'unavailable', reason: 'no-token' };

  try {
    await registerDevice({
      token,
      platform,
      appVersion: Constants.expoConfig?.version,
      deviceName: Device.deviceName ?? undefined,
    });
  } catch (error) {
    // The token is real but the server has not got it. Not stored, so the next
    // open tries again rather than believing this phone is registered.
    return { status: 'failed', error };
  }

  await savePushState({ token });
  return { status: 'registered', token };
}

/**
 * How long signing out may wait for the server to acknowledge the release.
 *
 * `http.ts` puts no deadline on a fetch, and the failure that matters here is
 * not "no signal" — that rejects in milliseconds — but the one-bar case a
 * technician actually meets: a request that neither answers nor fails, on a
 * site hoarding or behind a hotel's captive portal. Without a deadline, `await
 * releasePushDevice()` holds `signOut` open for as long as that socket does,
 * and the technician who tapped "Sign out" is left inside the session staring
 * at a button that did nothing.
 */
export const RELEASE_DEADLINE_MS = 3_000;

/**
 * Run `work`, but give up waiting after `ms`.
 *
 * `Promise.race` has already attached handlers to `work`, so a rejection that
 * arrives after the deadline is consumed rather than surfacing as an unhandled
 * rejection, and the timer is always cleared — a pending one would keep the
 * event loop (and Jest) alive past the last thing that cared.
 */
function withDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    work,
    new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('deadline')), ms);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/**
 * Take this phone off the list.
 *
 * Called on the way out of a session, **before** the tokens are cleared —
 * `DELETE /messaging/devices/:token` is an authenticated call, and after
 * sign-out there is no session to make it with. The van's phone gets handed
 * over; the next technician must not get the last one's jobs on the lock
 * screen.
 *
 * Resolves either way, never throws, and never waits longer than
 * {@link RELEASE_DEADLINE_MS}. A technician who taps "Sign out" in a basement
 * is signed out; the stale token is the server's to prune when a push to it
 * bounces.
 */
export async function releasePushDevice(): Promise<void> {
  const { token } = await loadPushState();
  if (!token) return;
  try {
    await withDeadline(unregisterDevice(token), RELEASE_DEADLINE_MS);
  } catch {
    // Offline, a token the server has already forgotten, or a request that
    // never came back. Either way the local record goes: this phone no longer
    // claims to be registered, and signing out is not held up by it.
  }
  await savePushState({ token: undefined });
}
