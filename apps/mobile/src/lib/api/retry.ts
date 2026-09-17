import { ApiError } from './errors';

/**
 * How the app reacts to a failure, by class rather than by status code
 * (docs/ARCHITECTURE.md §2.5). Both the query layer and the offline outbox
 * read the same classification, so a 403 is dropped and a 503 is retried the
 * same way whether the technician is looking at the screen or not.
 */
export type ErrorClass =
  /** No signal. Not the server's fault and not worth a retry loop. */
  | 'offline'
  /** The id token expired. The HTTP layer already tried a refresh. */
  | 'auth'
  /** The server will say the same thing next time: 403, 400, 422, 409, 404. */
  | 'permanent'
  /** The server is busy or down: 429, 5xx, 408. Worth coming back to. */
  | 'transient';

export function classifyError(error: unknown): ErrorClass {
  if (!(error instanceof ApiError)) {
    // A bug in our own code, not a server answer. Retrying it just repeats it.
    return 'permanent';
  }
  const { status } = error;
  if (status === 0) return 'offline';
  if (status === 401) return 'auth';
  if (status === 408 || status === 429 || status >= 500) return 'transient';
  return 'permanent';
}

/** Retry policy for a *query* — a read the technician is waiting on. */
export const MAX_QUERY_RETRIES = 3;

export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (classifyError(error) !== 'transient') return false;
  return failureCount < MAX_QUERY_RETRIES;
}

/**
 * Backoff for a queued write: 2 s → 5 s → 15 s → 1 min → 5 min → 15 min, then
 * doubling to a six-hour ceiling. A technician's phone spends whole visits in a
 * basement, so the tail is long on purpose — the queue is not trying to win a
 * race, it is trying not to give up.
 */
export const RETRY_SCHEDULE_MS = [
  2_000, 5_000, 15_000, 60_000, 300_000, 900_000,
] as const;

export const MAX_BACKOFF_MS = 6 * 60 * 60 * 1000;

/** ±20% of jitter, so a fleet of vans coming out of a dead zone does not stampede. */
const JITTER = 0.2;

/**
 * Delay before attempt number `attempt` (1-based: `attempt` 1 is the wait after
 * the first failure). `random` is injectable so tests get an exact number.
 */
export function backoffDelayMs(attempt: number, random = Math.random()): number {
  const index = Math.max(1, Math.floor(attempt)) - 1;
  const last = RETRY_SCHEDULE_MS[RETRY_SCHEDULE_MS.length - 1]!;
  const base =
    index < RETRY_SCHEDULE_MS.length
      ? RETRY_SCHEDULE_MS[index]!
      : Math.min(last * 2 ** (index - RETRY_SCHEDULE_MS.length + 1), MAX_BACKOFF_MS);
  const spread = base * JITTER * (random * 2 - 1);
  return Math.min(MAX_BACKOFF_MS, Math.max(0, Math.round(base + spread)));
}

/**
 * How many times a queued write may be attempted before it is parked for the
 * technician to look at.
 *
 * Idempotent operations get an unlimited budget: `tech/confirm` and
 * `tech/arrived` keep their first stamp however often they are replayed
 * (deals.controller.ts:184-189, :206-208), and the automatic texts dedupe on
 * `clientMessageId`. A note or a status move has no server-side idempotency,
 * so replaying it forever would eventually double it up — those get five tries
 * and then a visible "not sent" (docs/ARCHITECTURE.md §2.3, §2.5).
 */
export const MAX_NON_IDEMPOTENT_ATTEMPTS = 5;

export function hasAttemptsLeft(attempts: number, idempotent: boolean): boolean {
  return idempotent || attempts < MAX_NON_IDEMPOTENT_ATTEMPTS;
}
