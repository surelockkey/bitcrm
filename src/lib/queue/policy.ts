import {
  backoffDelayMs,
  classifyError,
  hasAttemptsLeft,
} from '../api/retry';
import type { OutboxKind, OutboxRecord, QueueState, UploadRecord } from './types';

/**
 * Which actions the server will absorb twice without harm.
 *
 * `tech/confirm` and `tech/arrived` keep their first stamp however often they
 * are replayed (deals.controller.ts:184-189, :206-208), and the two automatic
 * texts dedupe on the `clientMessageId` we send — which is the queue row's own
 * id. Those can be retried for as long as it takes.
 *
 * A note and a status move have **no** server-side idempotency. Replaying one
 * after an ambiguous failure would add a second note or re-announce a status,
 * so they get a bounded number of tries and then become visible
 * (docs/ARCHITECTURE.md §2.3).
 */
const IDEMPOTENT: ReadonlySet<OutboxKind> = new Set<OutboxKind>([
  'confirm',
  'arrived',
  'on_my_way',
  'late',
]);

export function isIdempotent(kind: OutboxKind): boolean {
  return IDEMPOTENT.has(kind);
}

export interface Attemptable {
  id: string;
  attempts: number;
  nextAttemptAt: number;
  state: QueueState;
}

/** A row the worker may pick up right now. */
export function isReady(record: Attemptable, now: number): boolean {
  return record.state === 'pending' && record.nextAttemptAt <= now;
}

/**
 * What the worker takes on this pass: **at most one row per job**.
 *
 * Order matters within a job — "arrived", then the status move, then the note —
 * and the server has no notion of our ordering, so the queue enforces it by
 * only ever having one row of a job in flight. Different jobs go in parallel.
 */
export function selectNextBatch<T extends Attemptable & { dealId: string; createdAt: number }>(
  records: readonly T[],
  now: number,
): T[] {
  const busy = new Set(
    records.filter((r) => r.state === 'sending').map((r) => r.dealId),
  );
  const ready = records
    .filter((r) => isReady(r, now))
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));

  const batch: T[] = [];
  const taken = new Set<string>();
  for (const record of ready) {
    if (busy.has(record.dealId) || taken.has(record.dealId)) continue;
    taken.add(record.dealId);
    batch.push(record);
  }
  return batch;
}

export interface FailureOutcome {
  state: QueueState;
  attempts: number;
  nextAttemptAt: number;
  lastError: string;
}

/**
 * Where a row goes after a failed attempt.
 *
 * - **offline** — not the row's fault. It stays `pending` and ready, so the
 *   moment connectivity returns the worker picks it straight back up. The
 *   attempt is not even counted against the budget: a basement is not a reason
 *   to give up on a note.
 * - **transient** (429, 5xx, a dead upstream) — `pending`, behind the backoff.
 * - **permanent** (403 not on the roster, 400 job already closed) and **auth**
 *   — `failed`. The server will say the same thing next time; the technician
 *   needs to see it, not have it retried silently forever.
 */
export function outcomeAfterFailure(
  record: Attemptable,
  error: unknown,
  message: string,
  now: number,
  random: () => number = Math.random,
  idempotent = true,
): FailureOutcome {
  const kind = classifyError(error);

  if (kind === 'offline') {
    return {
      state: 'pending',
      attempts: record.attempts,
      nextAttemptAt: now,
      lastError: message,
    };
  }

  const attempts = record.attempts + 1;

  if (kind === 'transient' && hasAttemptsLeft(attempts, idempotent)) {
    return {
      state: 'pending',
      attempts,
      nextAttemptAt: now + backoffDelayMs(attempts, random()),
      lastError: message,
    };
  }

  return { state: 'failed', attempts, nextAttemptAt: now, lastError: message };
}

/**
 * A presigned S3 PUT that comes back 403 has almost always expired. Throwing
 * the URL away and asking for a new ticket is the fix; retrying the same URL
 * would fail the same way until the queue gave up on a perfectly good photo.
 */
export function shouldRepresign(status: number): boolean {
  return status === 403 || status === 400;
}

/** Putting a parked row back in the queue, on the technician's say-so. */
export function retryPatch(now: number): Pick<
  Attemptable,
  'attempts' | 'nextAttemptAt' | 'state'
> & { lastError: null } {
  return { state: 'pending', attempts: 0, nextAttemptAt: now, lastError: null };
}

/**
 * An upload that has never been presigned has no ghost on the server yet, so
 * discarding it costs nothing. One that has been presigned already wrote its
 * metadata and a timeline entry, so the row is kept — "not sent" on the queue
 * screen is the honest state, and re-uploading fills the gap (§1.3).
 */
export function canDiscardSilently(record: Pick<UploadRecord, 'attachmentId'>): boolean {
  return record.attachmentId === null;
}

/** Rows to sweep: sent a while ago and no longer of interest. */
export const DONE_RETENTION_MS = 60_000;

export function isSweepable(
  record: Pick<OutboxRecord, 'state' | 'nextAttemptAt'>,
  now: number,
): boolean {
  return record.state === 'done' && now - record.nextAttemptAt > DONE_RETENTION_MS;
}
