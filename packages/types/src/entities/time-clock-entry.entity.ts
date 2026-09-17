/**
 * Where a clock-in or clock-out was made. Workiz distinguishes app entries from
 * web/admin ones in its activity log (§1.7 of the mobile-app notes: only ~29% of
 * `User clocked in` events were `native=1`), and payroll disputes are usually
 * settled by asking which it was.
 */
export const TIME_CLOCK_SOURCES = ['mobile', 'web'] as const;
export type TimeClockSource = (typeof TIME_CLOCK_SOURCES)[number];

/**
 * Where the phone was when the clock was punched. Optional at both ends: a
 * technician may refuse the location permission and must still be able to work.
 * Shape matches `Deal.arrivedLocation` so the two read the same on a map.
 */
export interface TimeClockLocation {
  lat: number;
  lng: number;
  /** GPS accuracy in metres, when the device reports it. */
  accuracy?: number;
}

/**
 * One clock-in → clock-out span for one person: the unit of the timesheet and,
 * later, of payroll.
 *
 * `startedAt`, `endedAt` and `minutes` are all written from the *server's*
 * clock. A phone's clock can be wrong by hours, or be set back deliberately, so
 * the client sends no timestamps at all — it sends the punch, the server stamps
 * it.
 */
export interface TimeClockEntry {
  id: string;
  userId: string;
  /** ISO instant, server-stamped at the start punch. */
  startedAt: string;
  /** ISO instant, server-stamped at the stop punch. Absent while running. */
  endedAt?: string;
  /** Server-computed from its own two stamps; absent while running. */
  minutes?: number;
  /** The job being worked, when the clock was started from a job screen. */
  dealId?: string;
  startLocation?: TimeClockLocation;
  endLocation?: TimeClockLocation;
  source: TimeClockSource;
  createdAt: string;
  updatedAt: string;
}

/** A period of a timesheet: the entries themselves plus their closed total. */
export interface TimeClockSummary {
  entries: TimeClockEntry[];
  /**
   * Sum of `minutes` over the CLOSED entries in the range. A still-running
   * entry contributes nothing — its duration is not a fact yet, and the app
   * ticks it live from `startedAt` anyway.
   */
  totalMinutes: number;
}

/**
 * Workiz's own rule, kept verbatim: "There must be at least a one-minute
 * separation between clocking in and clocking out" (help 18055805122065). It
 * exists because a double-tap on Start/Stop otherwise litters the timesheet
 * with zero-minute rows that a bookkeeper then has to delete by hand.
 */
export const TIME_CLOCK_MIN_MINUTES = 1;
