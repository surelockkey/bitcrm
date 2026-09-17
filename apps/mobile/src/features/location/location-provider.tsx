import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import * as Location from 'expo-location';
import { useAuth } from '../auth/auth-context';
import { useClockState } from '../timeclock/hooks';
import { isOnTheClock } from '../timeclock/lib';
import { clearReportedLocation, reportLocation } from './api';
import { LocationConsentSheet } from './components/LocationConsentSheet';
import {
  getLocationPermission,
  requestLocationPermission,
  type LocationPermission,
} from './permission';
import { toLocationPoint, WATCH_DISTANCE_M, WATCH_TIME_INTERVAL_MS } from './policy';
import { loadSharingPreference, saveSharingPreference } from './settings';
import { createLocationSender, type LocationSender } from './tracker';

/**
 * Location sharing, for exactly as long as the technician is on the clock.
 *
 * Four things all have to be true before a single point leaves the phone, and
 * any one of them going false stops it inside a render:
 *
 *   1. the technician is **on the clock** — off the clock the app has no
 *      business knowing where they are, and this is the promise the explainer
 *      screen makes;
 *   2. the **switch in Settings** is on (`settings.ts`), Workiz's own
 *      "Location Tracking" (§1.12);
 *   3. the **phone** has granted foreground location;
 *   4. the **app is open** on screen.
 *
 * (4) is not a shortcut, it is the boundary of what this app is allowed to
 * promise. Reporting a position with the app in the background needs a
 * foreground service and `ACCESS_BACKGROUND_LOCATION` on Android and `Always`
 * on iOS, each with a store declaration nobody has filed
 * (`WORKIZ_MOBILE_APP.md` §3, wave v3 — both marked as needing the owner's
 * accounts). It is also exactly where Workiz itself stops: "Workiz will only
 * track a user's location while the app is open on the device" (§1.12). So the
 * app tracks while it is open, says so on the explainer, and sends nothing at
 * all from the background rather than quietly half-doing it.
 */

export interface LocationSharingValue {
  /** The technician's own switch. Independent of what the phone allows. */
  enabled: boolean;
  setEnabled: (next: boolean) => Promise<void>;
  permission: LocationPermission;
  /** Shows the OS prompt. Only after the explainer has been read. */
  requestPermission: () => Promise<LocationPermission>;
  /** Re-reads the phone's answer — it can be changed in Settings behind us. */
  refreshPermission: () => Promise<void>;
  /**
   * Show the explainer. The phone's own prompt only ever follows this — the
   * system dialog cannot say who wants the location or why, and it is shown
   * once in the life of an install.
   */
  askForConsent: () => void;
  /** True while points are actually going to the server, right now. */
  isSharing: boolean;
  /** True when the clock is running (or a clock-in is still queued). */
  onTheClock: boolean;
}

const LocationSharingContext = createContext<LocationSharingValue | null>(null);

/**
 * "The app is open on the screen."
 *
 * Only `background` counts as closed. iOS reports `inactive` while the phone is
 * merely in a transition — the notification shade pulled down, a call banner,
 * the app switcher — and treating that as closed would stop and restart the
 * GPS several times a minute, which costs more battery than the tracking does.
 */
const isForeground = (status: AppStateStatus | null | undefined): boolean =>
  status !== 'background';

export function LocationSharingProvider({ children }: { children: React.ReactNode }) {
  const { state } = useAuth();
  const userId = state.status === 'signedIn' ? state.user.id : null;
  const clock = useClockState();
  const onTheClock = isOnTheClock(clock.state);

  const [enabled, setEnabledState] = useState(false);
  const [permission, setPermission] = useState<LocationPermission>('undetermined');
  const [isSharing, setIsSharing] = useState(false);
  const [appActive, setAppActive] = useState(() =>
    isForeground(AppState.currentState),
  );

  // The preference belongs to whoever is signed in, so it is re-read when the
  // phone changes hands rather than inherited from the last technician.
  useEffect(() => {
    let alive = true;
    if (!userId) {
      setEnabledState(false);
      return;
    }
    void loadSharingPreference(userId).then((value) => {
      if (alive) setEnabledState(value);
    });
    return () => {
      alive = false;
    };
  }, [userId]);

  const refreshPermission = useCallback(async () => {
    setPermission(await getLocationPermission());
  }, []);

  // Asked once at start and again whenever the app comes back: a technician who
  // went to the phone's Settings to allow (or revoke) location returns to an
  // app that already knows.
  useEffect(() => {
    void refreshPermission();
    const sub = AppState.addEventListener('change', (status) => {
      setAppActive(isForeground(status));
      if (status === 'active') void refreshPermission();
    });
    return () => sub.remove();
  }, [refreshPermission]);

  const setEnabled = useCallback(
    async (next: boolean) => {
      setEnabledState(next);
      if (userId) await saveSharingPreference(userId, next);
    },
    [userId],
  );

  const requestPermission = useCallback(async () => {
    const result = await requestLocationPermission();
    setPermission(result);
    return result;
  }, []);

  const active = Boolean(
    userId && onTheClock && enabled && permission === 'granted' && appActive,
  );

  /**
   * One sender per technician, outliving the watcher rather than owned by it.
   *
   * Everything this provider puts on the wire goes through it — the fixes and
   * the delete that takes the pin down — and it keeps them in order. Created
   * inside the watcher's effect instead, the delete would race the fix that was
   * still in flight when the technician clocked out, and could land first: the
   * pin would go down and then be put straight back up, where it would stay,
   * because the stored fix has no expiry.
   */
  const sender = useMemo<LocationSender | null>(
    () =>
      userId
        ? createLocationSender({
            send: (point) => reportLocation(userId, point),
            clear: () => clearReportedLocation(userId),
          })
        : null,
    [userId],
  );

  /**
   * Whether the watcher has ever run for this technician.
   *
   * Only a phone that actually reported a position needs to tell the server it
   * has stopped; without this, every app start would fire a DELETE for a fix
   * that was never there.
   */
  const reported = useRef(false);

  useEffect(() => {
    if (!active || !sender) {
      if (reported.current) {
        reported.current = false;
        setIsSharing(false);
        // Stopping means the pin goes, not that it freezes: the stored fix has
        // no expiry, so a technician who clocked out would otherwise stay on
        // the dispatch map exactly where they finished.
        //
        // Except when the session itself is what ended. Signing out is not
        // clocking out — the shift is still running as far as the office is
        // concerned — and the tokens are already gone by the time this runs, so
        // the request could only be a 401 that signs the app out a second time.
        if (sender) void sender.clear();
      }
      return;
    }

    let cancelled = false;
    let subscription: Location.LocationSubscription | null = null;

    void (async () => {
      try {
        const sub = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.Balanced,
            timeInterval: WATCH_TIME_INTERVAL_MS,
            distanceInterval: WATCH_DISTANCE_M,
          },
          (reading) => {
            const point = toLocationPoint(reading.coords);
            if (point) void sender.offer(point);
          },
        );
        // The effect was torn down while the watcher was starting — a clock-out
        // in the second it takes. Unsubscribe the one we just created rather
        // than leaving a GPS running with nothing listening.
        if (cancelled) {
          sub.remove();
          return;
        }
        subscription = sub;
        reported.current = true;
        setIsSharing(true);
      } catch {
        // No GPS hardware, location services switched off at the OS level, a
        // driver that will not answer: none of it is a reason to interrupt a
        // technician who is trying to work.
        if (!cancelled) setIsSharing(false);
      }
    })();

    return () => {
      cancelled = true;
      subscription?.remove();
      setIsSharing(false);
    };
  }, [active, sender]);

  /**
   * The explainer, owned here rather than by each screen that could trigger it.
   *
   * Two things can ask for it — the switch in Settings, and simply clocking in
   * with sharing on and the phone never yet asked — and both must not put two
   * copies of the same sheet on screen at once.
   */
  const [consentVisible, setConsentVisible] = useState(false);
  const askedThisSession = useRef(false);

  useEffect(() => {
    if (!onTheClock || !enabled || permission !== 'undetermined' || !appActive) return;
    // Once. A technician who reads it and taps "Not now" is not asked again for
    // the rest of the shift — the switch in Profile is how they change their
    // mind, and a sheet that reappears at every job is one they stop reading.
    if (askedThisSession.current) return;
    askedThisSession.current = true;
    setConsentVisible(true);
  }, [appActive, enabled, onTheClock, permission]);

  const askForConsent = useCallback(() => {
    askedThisSession.current = true;
    setConsentVisible(true);
  }, []);

  const value = useMemo<LocationSharingValue>(
    () => ({
      enabled,
      setEnabled,
      permission,
      requestPermission,
      refreshPermission,
      askForConsent,
      isSharing,
      onTheClock,
    }),
    [
      askForConsent,
      enabled,
      isSharing,
      onTheClock,
      permission,
      refreshPermission,
      requestPermission,
      setEnabled,
    ],
  );

  return (
    <LocationSharingContext.Provider value={value}>
      {children}
      <LocationConsentSheet
        visible={consentVisible}
        onAllow={() => {
          setConsentVisible(false);
          void requestPermission();
        }}
        onNotNow={() => setConsentVisible(false)}
        onTurnOff={() => {
          setConsentVisible(false);
          void setEnabled(false);
        }}
      />
    </LocationSharingContext.Provider>
  );
}

/**
 * The sharing state, or a dormant one when no provider is mounted.
 *
 * A missing provider throws in `useQueue`, and rightly: queueing without a
 * store loses a technician's work. Here it must not — the Settings row and the
 * clock card are rendered in tests and previews that have no reason to stand up
 * a GPS — so the fallback is "off, and nothing can turn it on", which is the
 * safe direction for a feature that reports somebody's position.
 */
const DORMANT: LocationSharingValue = {
  enabled: false,
  setEnabled: async () => {},
  permission: 'undetermined',
  requestPermission: async () => 'undetermined',
  refreshPermission: async () => {},
  askForConsent: () => {},
  isSharing: false,
  onTheClock: false,
};

export function useLocationSharing(): LocationSharingValue {
  return useContext(LocationSharingContext) ?? DORMANT;
}
