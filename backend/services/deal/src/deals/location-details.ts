import { distanceMeters } from '../common/utils/haversine';

/**
 * Past this many metres from the job's address, a status change or an
 * arrival was not made at the door: the office sees it in red (owner,
 * 2026-10-15). The phone's own accuracy is recorded beside it, not
 * subtracted — the office judges a poor fix for itself.
 */
export const FAR_FROM_ADDRESS_METERS = 500;

/** A GPS fix as the phone sends it. */
export interface PhoneFix {
  lat: number;
  lng: number;
  /** Reported accuracy of the fix, in metres. */
  accuracy?: number;
}

/**
 * What a `status_changed` / `tech_arrived` timeline entry carries, in its
 * `details`, when the phone sent a fix — read by the web's job timeline and
 * by the mobile app:
 *
 * - `location` — the fix itself;
 * - `distanceM` — whole metres from the job's address; absent when the
 *   address has no coordinates;
 * - `farFromAddress` — `distanceM > FAR_FROM_ADDRESS_METERS`; present
 *   exactly when `distanceM` is.
 *
 * An entry made without a fix (every change from the web) has none of them.
 */
export interface TimelineLocationDetails {
  location: PhoneFix;
  distanceM?: number;
  farFromAddress?: boolean;
}

const isCoordinate = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * The fields to spread into a timeline entry's `details` for a phone's fix
 * taken at the job `address` — `{}` when there is no fix, so an entry made
 * without one is exactly what it was before.
 */
export function timelineLocationDetails(
  fix: PhoneFix | null | undefined,
  address: { lat?: number; lng?: number } | undefined,
): TimelineLocationDetails | Record<string, never> {
  if (!fix) return {};
  // A plain object: the fix may be a validated DTO instance.
  const location: PhoneFix = {
    lat: fix.lat,
    lng: fix.lng,
    ...(fix.accuracy !== undefined ? { accuracy: fix.accuracy } : {}),
  };
  if (!isCoordinate(address?.lat) || !isCoordinate(address?.lng)) return { location };

  const distanceM = Math.round(distanceMeters(address.lat, address.lng, location.lat, location.lng));
  return { location, distanceM, farFromAddress: distanceM > FAR_FROM_ADDRESS_METERS };
}
