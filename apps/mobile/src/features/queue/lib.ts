import type { QueueRecord, QueueState } from '../../lib/queue/types';
import { statusLabel } from '../jobs/lib';
import type { StatusPayload } from './transport';

/**
 * Turning the queue into something a technician can read.
 *
 * The whole value of a durable queue is that nothing disappears quietly, and a
 * row nobody can name has disappeared as far as the person holding the phone is
 * concerned. So every row gets a plain-English title, a plain-English state,
 * and — where it makes sense — a way to act on it (docs/ARCHITECTURE.md §2.5).
 */

export interface QueueItemView {
  id: string;
  queue: 'outbox' | 'uploads';
  dealId: string;
  /** What the technician did. "Arrived", "Note", "Photo — job-K4T9ZW…". */
  title: string;
  /** Where it has got to. "Waiting for a connection", "Not sent: …". */
  detail: string;
  state: QueueState;
  canRetry: boolean;
  /** Only an upload that never reached presign can be dropped without a trace. */
  canDiscard: boolean;
  progress?: number;
}

/** "in 2 min", for a row waiting out a backoff. */
export function formatWait(ms: number): string {
  if (ms <= 0) return 'now';
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return 'in under a minute';
  if (minutes < 60) return `in ${minutes} min`;
  const hours = Math.round(minutes / 60);
  return `in ${hours} ${hours === 1 ? 'hour' : 'hours'}`;
}

function titleFor(record: QueueRecord): string {
  if (record.queue === 'uploads') return `Photo — ${record.fileName}`;
  switch (record.kind) {
    case 'confirm':
      return 'Confirmed receipt';
    case 'arrived':
      return 'Arrived';
    case 'note':
      return 'Note';
    case 'on_my_way':
      return 'Text: on my way';
    case 'late':
      return 'Text: running late';
    case 'chat':
      return 'Message to the office';
    // A clock row is the one kind whose failure costs money, so it is named as
    // plainly as possible: a technician scanning this list has to spot it.
    case 'timeclock_in':
      return record.dealId ? 'Clocked in on a job' : 'Clocked in';
    case 'timeclock_out':
      return 'Clocked out';
    case 'status': {
      try {
        const payload = JSON.parse(record.payload) as StatusPayload;
        return `Status: ${statusLabel(payload.superStatus)}`;
      } catch {
        return 'Status change';
      }
    }
  }
}

function detailFor(record: QueueRecord, now: number): string {
  switch (record.state) {
    case 'done':
      return 'Sent';
    case 'sending':
      return record.queue === 'uploads'
        ? `Uploading ${Math.round(record.progress * 100)}%`
        : 'Sending…';
    case 'unknown':
      return (
        record.lastError ??
        'The app closed while this was being sent, so it may already have been sent.'
      );
    case 'failed':
      return `Not sent${record.lastError ? `: ${record.lastError}` : ''}`;
    case 'pending':
      return record.nextAttemptAt > now
        ? `Trying again ${formatWait(record.nextAttemptAt - now)}`
        : 'Waiting for a connection';
  }
}

/**
 * Unknown first, then failed — both need a person, and an unknown row needs a
 * decision rather than a tap — then in flight, then waiting, then sent.
 */
const ORDER: Record<QueueState, number> = {
  unknown: 0,
  failed: 1,
  sending: 2,
  pending: 3,
  done: 4,
};

export function describeQueue(
  records: readonly QueueRecord[],
  now: number,
): QueueItemView[] {
  return [...records]
    .sort(
      (a, b) =>
        ORDER[a.state] - ORDER[b.state] ||
        a.createdAt - b.createdAt ||
        a.id.localeCompare(b.id),
    )
    .map((record) => ({
      id: record.id,
      queue: record.queue,
      dealId: record.dealId,
      title: titleFor(record),
      detail: detailFor(record, now),
      state: record.state,
      // Retrying something already in flight would send it twice. An unknown
      // row can be sent again, but only because somebody chose to.
      canRetry:
        record.state === 'failed' ||
        record.state === 'pending' ||
        record.state === 'unknown',
      canDiscard:
        (record.state === 'failed' || record.state === 'unknown') &&
        (record.queue === 'outbox' || record.attachmentId === null),
      ...(record.queue === 'uploads' ? { progress: record.progress } : {}),
    }));
}

export interface QueueSummaryCounts {
  waiting: number;
  sending: number;
  failed: number;
  /** Sent, maybe. Nobody can say — see QueueState['unknown']. */
  unknown: number;
}

export function summarizeQueue(records: readonly QueueRecord[]): QueueSummaryCounts {
  return {
    waiting: records.filter((r) => r.state === 'pending').length,
    sending: records.filter((r) => r.state === 'sending').length,
    failed: records.filter((r) => r.state === 'failed').length,
    unknown: records.filter((r) => r.state === 'unknown').length,
  };
}

/**
 * What goes on the tab. `undefined` rather than 0 — react-navigation draws a
 * badge for any defined value, and an empty circle over "Queue" reads as a
 * problem where there is none.
 */
export function tabBadge(counts: QueueSummaryCounts): string | undefined {
  const outstanding =
    counts.waiting + counts.sending + counts.failed + counts.unknown;
  if (!outstanding) return undefined;
  return outstanding > 9 ? '9+' : String(outstanding);
}

/**
 * How often the Queue screen has to re-render to keep a countdown honest.
 *
 * `describeQueue` is a pure function of `(records, now)`, and records only
 * change when a drain settles something — so without a tick, "Trying again in
 * 14 min" is frozen at whatever it read when the screen mounted and still says
 * so long after the attempt happened. One second while something is nearly
 * due, half a minute otherwise; nothing at all while there is nothing pending.
 */
export const QUEUE_TICK_NEAR_MS = 1_000;
export const QUEUE_TICK_FAR_MS = 30_000;

export function queueTickInterval(
  records: readonly QueueRecord[],
  now: number,
): number | null {
  const waits = records
    .filter((r) => r.state === 'pending')
    .map((r) => r.nextAttemptAt - now);
  if (!waits.length) return null;
  const soonest = Math.min(...waits);
  return soonest <= 60_000 ? QUEUE_TICK_NEAR_MS : QUEUE_TICK_FAR_MS;
}
