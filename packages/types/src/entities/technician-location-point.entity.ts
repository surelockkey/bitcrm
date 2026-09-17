/**
 * One persisted fix on a technician's track — the history behind the live
 * presence dot.
 *
 * `TechnicianLocation` answers "where is he now"; this answers "where has he
 * been today", which is the question a dispatcher actually asks when a client
 * says nobody turned up. Only a sampled subset of the fixes a phone reports is
 * kept (see the location service's sampling rule), and only while the
 * technician is on the clock — off-clock movement is not the company's
 * business.
 */
export interface TechnicianLocationPoint {
  userId: string;
  /** ISO instant, server-stamped when the fix was accepted. */
  recordedAt: string;
  lat: number;
  lng: number;
  /** GPS accuracy in metres, when the device reports it. */
  accuracy?: number;
  /** The time-clock entry that was running when the fix was kept. */
  timeClockEntryId?: string;
}
