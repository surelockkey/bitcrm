import { http } from '../../lib/api/http';

/**
 * Where the technician is, while they are on the clock.
 *
 * `POST /users/technicians/:id/location` is guarded by `technicians.edit`
 * **and self** — a phone may only report its own owner's position
 * (`technician-location.controller.ts:39`). The service keeps one fix per
 * technician in Redis and overwrites it, which is why `policy.ts` throttles
 * hard: sending ten points a minute would leave exactly the same single row
 * behind, having spent a technician's battery and data to do it.
 */

export interface LocationPoint {
  lat: number;
  lng: number;
  /** Metres. Dropped rather than sent when the phone reports nonsense. */
  accuracy?: number;
}

export interface ReportedLocation extends LocationPoint {
  userId: string;
  updatedAt: string;
}

export const reportLocation = (
  userId: string,
  point: LocationPoint,
): Promise<ReportedLocation> =>
  http.post<ReportedLocation>(`/users/technicians/${userId}/location`, point);

/**
 * Go offline: remove the live fix outright.
 *
 * Sent the moment sharing stops — clocking out, or the toggle going off. The
 * stored fix has **no expiry** (`technician-location.service.ts`: "No expiry —
 * the last location is kept until a newer one replaces it"), so without this
 * the dispatch map would keep showing a pin where the technician was when they
 * finished, for as long as nobody else moved it. "Stopped sharing" has to mean
 * the position is gone, not frozen.
 */
export const clearReportedLocation = (userId: string): Promise<unknown> =>
  http.delete(`/users/technicians/${userId}/location`);
