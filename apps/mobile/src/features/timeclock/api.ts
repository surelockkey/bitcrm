import { http } from '../../lib/api/http';
import type {
  StartClockBody,
  StopClockBody,
  TimeClockEntry,
  TimeClockReport,
} from './types';

/**
 * The time clock lives in user-service, beside technicians, under the gateway's
 * `/api/users` prefix — so the paths here read `/users/timeclock/…`, the same
 * way `features/auth/api.ts` writes `/users/me`.
 */

/**
 * Start the clock.
 *
 * The body may carry more than the contract names: `ValidationPipe` runs with
 * `whitelist: true` and **no** `forbidNonWhitelisted` (user-service `main.ts`),
 * so an unknown field is stripped rather than rejected. That is what lets the
 * queued row carry the moment the technician actually tapped — see
 * `features/queue/transport.ts` for why it does.
 */
export const startClock = (body: StartClockBody): Promise<TimeClockEntry> =>
  http.post<TimeClockEntry>('/users/timeclock/start', body);

export const stopClock = (body: StopClockBody = {}): Promise<TimeClockEntry> =>
  http.post<TimeClockEntry>('/users/timeclock/stop', body);

/**
 * The entry that is still running, or `null` when the technician is off the
 * clock. `null` is an answer, not an absence — the screen shows "Not on the
 * clock" rather than a spinner.
 */
export const getCurrentClock = (): Promise<TimeClockEntry | null> =>
  http.get<TimeClockEntry | null>('/users/timeclock/current');

export interface TimeClockRange {
  /** ISO instant. */
  from: string;
  /** ISO instant. */
  to: string;
}

/**
 * A technician's own entries over a range.
 *
 * `userId` is deliberately never sent: a technician may read only their own
 * entries, and asking for somebody else's needs a permission they do not hold.
 * The server defaults it to the caller, so the safe request is the short one.
 */
export const listClockEntries = ({ from, to }: TimeClockRange): Promise<TimeClockReport> => {
  const q = new URLSearchParams({ from, to });
  return http.get<TimeClockReport>(`/users/timeclock?${q.toString()}`);
};
