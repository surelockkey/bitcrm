/**
 * How often a reported fix is kept.
 *
 * A phone on a job sends a position every few seconds; storing every tick would
 * be ~10 000 rows per technician per day to answer a question ("where was he
 * this morning?") that a hundred rows answers just as well. The rule is:
 *
 *   - never more than one point a minute, whatever the phone does;
 *   - then keep it if he has moved 100 m since the last kept point;
 *   - and keep one every 5 minutes regardless, so a van parked outside a
 *     client's house leaves a trail saying "still here" rather than a gap that
 *     reads like the app died.
 *
 * Driving that is at most 60 points an hour; standing still, 12.
 */
export const MIN_SAMPLE_INTERVAL_MS = 60_000;
export const MOVE_THRESHOLD_METRES = 100;
export const HEARTBEAT_INTERVAL_MS = 300_000;

export interface TrackSample {
  lat: number;
  lng: number;
  /** ISO instant this sample was kept. */
  at: string;
}

/** Metres between two fixes (haversine — well inside GPS error at these ranges). */
export function distanceMetres(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const EARTH_RADIUS_M = 6_371_000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;

  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Whether this fix earns a row. `last` is null when nothing has been kept yet
 * (first fix of the shift, or the cached marker was lost) — then keep it: one
 * extra row costs nothing, a missing first point loses the start of the trail.
 */
export function shouldKeepPoint(
  last: TrackSample | null,
  next: { lat: number; lng: number },
  nowISO: string,
): boolean {
  if (!last) return true;

  const sinceMs = Date.parse(nowISO) - Date.parse(last.at);
  // A clock that jumped backwards would otherwise pin the rate limiter open.
  if (sinceMs < 0) return true;
  if (sinceMs < MIN_SAMPLE_INTERVAL_MS) return false;
  if (sinceMs >= HEARTBEAT_INTERVAL_MS) return true;

  return distanceMetres(last, next) >= MOVE_THRESHOLD_METRES;
}
