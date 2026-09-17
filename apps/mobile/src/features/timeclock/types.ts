/**
 * The time clock, as the contract fixes it.
 *
 * Everything else the phone reads comes from `@bitcrm/types`, so the server
 * renaming a field breaks this build rather than reaching a technician as
 * `undefined` (see `features/jobs/types.ts`). The clock cannot yet: it is
 * landing in user-service in parallel with this screen, and the shared package
 * has no `TimeClockEntry` to import. So it is declared here, from the agreed
 * contract, and moves to `@bitcrm/types` the moment the package carries it —
 * at which point this file becomes a re-export and any drift stops compiling.
 */

/** Which end of the system recorded the entry. */
export type TimeClockSource = 'mobile' | 'web';

/** A fix as the rest of BitCRM writes one (`Deal.arrivedLocation`). */
export interface TimeClockFix {
  lat: number;
  lng: number;
  accuracy?: number;
}

export interface TimeClockEntry {
  id: string;
  userId: string;
  /** ISO. The server's stamp — the only one the app ever displays. */
  startedAt: string;
  /** Absent while the entry is still running. */
  endedAt?: string;
  /** The server's own arithmetic, present once the entry is closed. */
  minutes?: number;
  /** Set when the clock was started from a job rather than for the day. */
  dealId?: string;
  /**
   * Where the phone was at each end. Nothing on this screen reads them — they
   * are dispatch's business, not the technician's — so they are declared for
   * completeness and a different spelling on the server costs nothing until
   * something here actually shows one.
   */
  startLocation?: TimeClockFix;
  endLocation?: TimeClockFix;
  source: TimeClockSource;
  createdAt: string;
  updatedAt: string;
}

/** `POST /users/timeclock/start`. */
export interface StartClockBody {
  dealId?: string;
  lat?: number;
  lng?: number;
  accuracy?: number;
  source: TimeClockSource;
  /**
   * The moment the technician tapped, by the phone's own clock.
   *
   * **Not part of the agreed contract**, and deliberately so. The server stamps
   * `startedAt` when the request arrives, and a row queued in a basement can
   * arrive an hour after the shift began — payroll would be an hour short. The
   * phone therefore records what it knows. Today user-service strips the field
   * (`ValidationPipe({ whitelist: true })`, no `forbidNonWhitelisted`), so it
   * costs one key on the wire and cannot break the call; the day the backend
   * accepts it, every already-installed phone starts sending the truth.
   */
  clientStartedAt?: string;
}

/** `POST /users/timeclock/stop`. */
export interface StopClockBody {
  lat?: number;
  lng?: number;
  accuracy?: number;
  /** The phone's stamp of the tap. Same reasoning as `clientStartedAt`. */
  clientEndedAt?: string;
}

/** What a queued clock-in carries: the phone's stamp is not optional here. */
export type ClockInPayload = StartClockBody & { clientStartedAt: string };
export type ClockOutPayload = StopClockBody & { clientEndedAt: string };

/** What `GET /users/timeclock?from=&to=` answers with. */
export interface TimeClockReport {
  entries: TimeClockEntry[];
  /**
   * The server's sum. Deliberately **not** what the timesheet displays: the
   * contract does not say whether a still-running entry contributes to it, and
   * a total that quietly counts half a shift is the one number on this screen
   * nobody may guess at. The phone sums the finished entries itself (`lib.ts`).
   */
  totalMinutes: number;
}
