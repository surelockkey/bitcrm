/**
 * A technician's live, self-reported position.
 *
 * Ephemeral: written while the technician is online (their app/tab open and
 * sharing location) and expires shortly after the last update, so a stale
 * position never lingers on the dispatch map. When there is no live location,
 * the map falls back to the *derived* position (home, or last job of the day).
 */
export interface TechnicianLocation {
  userId: string;
  lat: number;
  lng: number;
  /** GPS accuracy in metres, when the source reports it. */
  accuracy?: number;
  /** ISO timestamp of this fix. */
  updatedAt: string;
}
