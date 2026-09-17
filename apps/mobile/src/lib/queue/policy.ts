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
 * texts — like a chat line — dedupe on the `clientMessageId` we send, which is
 * the queue row's own id. Those can be retried for as long as it takes.
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
  'chat',
]);

export function isIdempotent(kind: OutboxKind): boolean {
  return IDEMPOTENT.has(kind);
}

/**
 * Kinds that put words in front of a **client**, and are therefore only true
 * for a little while.
 *
 * "I'm on my way" and "I'll be 15 minutes late" are statements about right
 * now. An arrival stamp is timeless — it says when something happened and is
 * just as correct sent a day later — but a text that leaves the queue after
 * the visit is over is worse than one never sent: the client is told something
 * that is no longer true, by a technician who has already been and gone
 * (docs/ARCHITECTURE.md §2.3).
 *
 * A chat line is deliberately **not** here: it is addressed to a colleague in
 * the office, and "the gate code did not work" is still worth reading an hour
 * after it was written in a basement.
 */
const CLIENT_VISIBLE: ReadonlySet<OutboxKind> = new Set<OutboxKind>([
  'on_my_way',
  'late',
]);

/** Past this, a queued client text is stale rather than late. */
export const CLIENT_VISIBLE_MAX_AGE_MS = 30 * 60_000;

export const TOO_OLD_MESSAGE =
  'Not sent — too long since you tapped it. The client would have been told something that is no longer true.';

export function isTooOldToSend(
  record: Pick<OutboxRecord, 'kind' | 'createdAt'>,
  now: number,
): boolean {
  return (
    CLIENT_VISIBLE.has(record.kind) &&
    now - record.createdAt > CLIENT_VISIBLE_MAX_AGE_MS
  );
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
 * The technician has one clock, whatever it was started from.
 *
 * A clock-in on a job carries that job's id and a clock-out carries none, so
 * lanes taken from `dealId` would put the two halves of one shift in different
 * lanes — and the "out" could then overtake the "in" on its way through a
 * returning connection. The server would see a shift that ended before it
 * began.
 */
const TIMECLOCK: ReadonlySet<OutboxKind> = new Set<OutboxKind>([
  'timeclock_in',
  'timeclock_out',
]);

/**
 * Which rows must not overtake one another.
 *
 * A job is one lane: "arrived", then the status move, then the note. The chat
 * is another — the technician has a single thread with the office, and two
 * lines typed seconds apart have to reach it in the order they were written.
 * A chat row's `dealId` is the job it is *about* (empty when it is about none),
 * so it cannot serve as the lane. The clock is a third, for the reason above.
 */
export function laneOf(record: { dealId: string; kind?: OutboxKind }): string {
  if (record.kind === 'chat') return 'chat';
  if (record.kind && TIMECLOCK.has(record.kind)) return 'timeclock';
  return `deal:${record.dealId}`;
}

/**
 * What the worker takes on this pass: **at most one row per lane**.
 *
 * Order matters within a job — "arrived", then the status move, then the note —
 * and the server has no notion of our ordering, so the queue enforces it by
 * only ever having one row of a lane in flight. Different lanes go in parallel.
 */
export function selectNextBatch<
  T extends Attemptable & { dealId: string; createdAt: number; kind?: OutboxKind },
>(records: readonly T[], now: number): T[] {
  const busy = new Set(
    records.filter((r) => r.state === 'sending').map(laneOf),
  );
  const ready = records
    .filter((r) => isReady(r, now))
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));

  const batch: T[] = [];
  const taken = new Set<string>();
  for (const record of ready) {
    const lane = laneOf(record);
    if (busy.has(lane) || taken.has(lane)) continue;
    taken.add(lane);
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
 * - **auth** (401) — also not the row's fault, and **never terminal**. The
 *   HTTP layer has already tried one refresh; a 401 that survives it means the
 *   session needs renewing, not that the arrival was wrong. It stays `pending`
 *   behind the backoff, so a token blip on a bad connection cannot park a
 *   shift's worth of work permanently. The drain is gated on a signed-in
 *   session (queue-provider.tsx), and a second 401 signs the technician out,
 *   so this cannot spin: the row simply waits for the next session.
 * - **transient** (429, 5xx, a dead upstream) — `pending`, behind the backoff.
 * - **permanent** (403 not on the roster, 400 job already closed) — `failed`.
 *   The server will say the same thing next time; the technician needs to see
 *   it, not have it retried silently forever.
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

  if (kind === 'auth') {
    return {
      state: 'pending',
      attempts,
      nextAttemptAt: now + backoffDelayMs(attempts, random()),
      lastError: message,
    };
  }

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
