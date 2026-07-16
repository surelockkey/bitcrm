"use client";

import { useEffect, useRef } from "react";
import { postLocation } from "./api";

/** Don't re-post more often than this — the backend fix stays live for minutes. */
const MIN_INTERVAL_MS = 25_000;

const GEO_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  maximumAge: 15_000,
  timeout: 20_000,
};

/**
 * While a technician is online, stream their browser location to the dispatch map.
 *
 * "Online" is the tab being open with this mounted — on unmount (navigating away,
 * closing, logging out) we drop the live fix so they don't hang frozen on the
 * map. Position updates are throttled: the browser fires them far more often than
 * the map needs, and the stored fix is short-lived anyway.
 *
 * This is browser geolocation, not background GPS: it only runs while the tab is
 * alive. A native app would be needed for true background tracking.
 */
export function useLocationBroadcast(
  technicianId: string | undefined,
  enabled: boolean,
): void {
  // −Infinity, not 0: at epoch 0 a `0` sentinel would throttle the very first fix.
  const lastSent = useRef(Number.NEGATIVE_INFINITY);

  useEffect(() => {
    if (!enabled || !technicianId) return;
    if (typeof navigator === "undefined" || !navigator.geolocation) return;

    // Capture the object, so cleanup still works if the global changes.
    const geolocation = navigator.geolocation;
    const watchId = geolocation.watchPosition(
      (pos) => {
        const now = Date.now();
        if (now - lastSent.current < MIN_INTERVAL_MS) return;
        lastSent.current = now;

        // A failed post must not break the field app — the next fix retries.
        void postLocation(technicianId, {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        }).catch(() => {});
      },
      // Permission denied / unavailable — silently stop; the map falls back to
      // the derived position (home or last job).
      () => {},
      GEO_OPTIONS,
    );

    // Stop watching, but keep the last fix — the map shows where the technician
    // was last seen (with the time) after they go offline.
    return () => {
      geolocation.clearWatch(watchId);
    };
  }, [technicianId, enabled]);
}
