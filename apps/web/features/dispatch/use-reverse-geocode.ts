"use client";

import { useEffect, useReducer, useRef } from "react";
import { useMapsLibrary } from "@vis.gl/react-google-maps";
import type { TechnicianPosition } from "./lib";

/** ~11 m — a technician who hasn't moved this far reuses the cached address. */
const COORD_PRECISION = 4;

const coordKey = (lat: number, lng: number) =>
  `${lat.toFixed(COORD_PRECISION)},${lng.toFixed(COORD_PRECISION)}`;

/**
 * Reverse-geocode technician positions to street addresses, so the roster can
 * say *where* a technician is, not just plot a dot.
 *
 * Cached hard by rounded coordinates: a stationary technician is geocoded once,
 * and polling doesn't re-bill Google while they stay put. Returns userId →
 * address; entries fill in as lookups resolve. Without a Maps key it stays empty
 * and callers simply show no address.
 */
export function useReverseGeocode(
  positions: TechnicianPosition[],
): Map<string, string> {
  const geocodingLib = useMapsLibrary("geocoding");
  const byCoord = useRef(new Map<string, string>());
  const byUser = useRef(new Map<string, string>());
  const [, rerender] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    if (!geocodingLib) return;
    const geocoder = new geocodingLib.Geocoder();
    let cancelled = false;

    (async () => {
      let changed = false;
      for (const position of positions) {
        const key = coordKey(position.lat, position.lng);
        let address = byCoord.current.get(key);

        if (!address) {
          try {
            const { results } = await geocoder.geocode({
              location: { lat: position.lat, lng: position.lng },
            });
            address = results[0]?.formatted_address;
            if (address) byCoord.current.set(key, address);
          } catch {
            // A failed lookup just leaves the address blank; never blocks the UI.
          }
        }

        if (address && byUser.current.get(position.userId) !== address) {
          byUser.current.set(position.userId, address);
          changed = true;
        }
      }
      if (!cancelled && changed) rerender();
    })();

    return () => {
      cancelled = true;
    };
  }, [geocodingLib, positions]);

  return byUser.current;
}
