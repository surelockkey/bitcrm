import { reportableAccuracy } from '../jobs/location';
import type { LocationPoint } from './api';

/**
 * When a reading is worth a request.
 *
 * The server keeps exactly one fix per technician and overwrites it
 * (`technician-location.service.ts`), so the only thing more traffic buys is a
 * fresher pin on the dispatch map. The rate is therefore set by what dispatch
 * actually needs — "where is he now, and is he moving" — and by what a phone in
 * a van can afford all day:
 *
 *   - **movement**: a fix far enough from the last one we sent goes out as soon
 *     as the floor below allows. This is the case dispatch cares about.
 *   - **heartbeat**: a technician parked at a job still reports every few
 *     minutes, so a stale pin means "parked", not "phone dead".
 *   - **a floor**: never more than one request per half-minute, whatever the
 *     GPS says. Without it a poor fix jittering by a hundred metres on a
 *     doorstep would post continuously.
 *
 * Pure, so the rate is a test rather than something only measurable by watching
 * a battery drain.
 */

/** Never more often than this, however much the reading moves. */
export const MIN_SEND_INTERVAL_MS = 30_000;

/** A reading this far from the last sent one is news. */
export const MOVED_DISTANCE_M = 75;

/** A stationary technician still reports this often. */
export const HEARTBEAT_MS = 5 * 60_000;

/** What the watcher asks the OS for; the gate above decides what is sent. */
export const WATCH_TIME_INTERVAL_MS = 20_000;
export const WATCH_DISTANCE_M = 40;

const EARTH_RADIUS_M = 6_371_000;
const toRadians = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in metres. Metres matter here; kilometres do not. */
export function distanceMeters(a: LocationPoint, b: LocationPoint): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** The last point this phone actually sent, and when. */
export interface LastSent {
  point: LocationPoint;
  at: number;
}

export function shouldSendFix(
  last: LastSent | null,
  next: LocationPoint,
  now: number,
): boolean {
  // The first fix of a shift always goes: until it lands, dispatch has no pin
  // at all, and a technician who has just clocked in is the one they look for.
  if (!last) return true;
  const since = now - last.at;
  if (since < MIN_SEND_INTERVAL_MS) return false;
  if (distanceMeters(last.point, next) >= MOVED_DISTANCE_M) return true;
  return since >= HEARTBEAT_MS;
}

/**
 * Shape a raw reading into what the endpoint accepts.
 *
 * `SetLocationDto` bounds latitude and longitude and rejects the request
 * outright if either is out of range, so a garbage reading is dropped here
 * rather than turned into a 400 in the middle of a shift. Accuracy follows the
 * same rule the arrival fix does (`jobs/location.ts`): a network-derived fix
 * can claim hundreds of kilometres, and that number is an annotation, not a
 * reason to lose the position it annotates.
 */
export function toLocationPoint(coords: {
  latitude: number;
  longitude: number;
  accuracy?: number | null;
}): LocationPoint | null {
  const { latitude: lat, longitude: lng } = coords;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return {
    lat,
    lng,
    ...(reportableAccuracy(coords.accuracy) ? { accuracy: coords.accuracy! } : {}),
  };
}
