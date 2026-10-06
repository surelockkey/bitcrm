"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useApiLoadingStatus, useMapsLibrary } from "@vis.gl/react-google-maps";
import { env } from "@/lib/env";
import type { TechnicianPosition } from "./lib";

/** ~11 m — a technician who hasn't moved this far reuses the cached address. */
const COORD_PRECISION = 4;

const coordKey = (lat: number, lng: number) =>
  `${lat.toFixed(COORD_PRECISION)},${lng.toFixed(COORD_PRECISION)}`;

/**
 * A lookup that failed is asked again after this long. Google meters the
 * client-side geocoder per session — a burst past the first handful is
 * refused, and the quota refills by the second — so a refusal now is often
 * an answer later.
 */
const RETRY_AFTER_MS = 30_000;

/**
 * The longest a board waits on Google for its streets. Past it the roster is
 * shown without the ones still out, and they fill in when they come.
 */
export const GEOCODE_WAIT_MS = 2_000;

export interface ReverseGeocode {
  /** userId → street address, for every technician whose spot has one. */
  addresses: Map<string, string>;
  /**
   * Lookups the roster is still waiting for — the page holds its first frame
   * on this, so the address lines are drawn with the rows instead of pushing
   * them down one by one. False when there is nothing to wait for: no Maps
   * key, a Maps API that failed to load, or a wait past `GEOCODE_WAIT_MS`.
   */
  pending: boolean;
}

/**
 * Reverse-geocode technician positions to street addresses, so the roster can
 * say *where* a technician is, not just plot a dot.
 *
 * Every spot not yet known is looked up at once — they used to go one after
 * another, each answer a new line in the roster a tenth of a second after the
 * last. Cached hard by rounded coordinates: a stationary technician is
 * geocoded once, and polling doesn't re-bill Google while they stay put.
 * Without a Maps key it stays empty and callers simply show no address.
 */
export function useReverseGeocode(positions: TechnicianPosition[], enabled = true): ReverseGeocode {
  const geocodingLib = useMapsLibrary("geocoding");
  const status = useApiLoadingStatus();
  // coordKey → the street there; `undefined` while a failed lookup waits to be retried.
  const [found, setFound] = useState<ReadonlyMap<string, string | undefined>>(() => new Map());
  const inFlight = useRef(new Set<string>());
  const retries = useRef(new Set<ReturnType<typeof setTimeout>>());

  const usable = enabled && Boolean(env.googleMapsApiKey) && status !== "FAILED" && status !== "AUTH_FAILURE";

  // The spots nobody has asked Google about yet, one exact position per key.
  const wanted = useMemo(() => {
    const out = new Map<string, { lat: number; lng: number }>();
    for (const p of positions) {
      const key = coordKey(p.lat, p.lng);
      if (!found.has(key) && !out.has(key)) out.set(key, { lat: p.lat, lng: p.lng });
    }
    return out;
  }, [positions, found]);

  useEffect(() => {
    if (!geocodingLib || !usable) return;
    const geocoder = new geocodingLib.Geocoder();
    for (const [key, location] of wanted) {
      if (inFlight.current.has(key)) continue;
      inFlight.current.add(key);
      geocoder
        .geocode({ location })
        .then(({ results }) => results[0]?.formatted_address)
        // A failed lookup just leaves the address blank; never blocks the UI.
        .catch(() => undefined)
        .then((address) => {
          inFlight.current.delete(key);
          setFound((prev) => new Map(prev).set(key, address));
          if (address) return;
          const timer = setTimeout(() => {
            retries.current.delete(timer);
            setFound((prev) => {
              const next = new Map(prev);
              next.delete(key);
              return next;
            });
          }, RETRY_AFTER_MS);
          retries.current.add(timer);
        });
    }
  }, [geocodingLib, usable, wanted]);

  useEffect(() => {
    const timers = retries.current;
    return () => {
      for (const t of timers) clearTimeout(t);
    };
  }, []);

  const addresses = useMemo(() => {
    const byUser = new Map<string, string>();
    for (const p of positions) {
      const address = found.get(coordKey(p.lat, p.lng));
      if (address) byUser.set(p.userId, address);
    }
    return byUser;
  }, [positions, found]);

  // Waiting: on the Maps library itself, or on spots it has not answered yet.
  const waiting = usable && (geocodingLib === null || wanted.size > 0);
  const [gaveUp, setGaveUp] = useState(false);
  if (!waiting && gaveUp) setGaveUp(false);
  useEffect(() => {
    if (!waiting) return;
    const timer = setTimeout(() => setGaveUp(true), GEOCODE_WAIT_MS);
    return () => clearTimeout(timer);
  }, [waiting]);

  return { addresses, pending: waiting && !gaveUp };
}
