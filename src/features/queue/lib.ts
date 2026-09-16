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
    case 'failed':
      return `Not sent${record.lastError ? `: ${record.lastError}` : ''}`;
    case 'pending':
      return record.nextAttemptAt > now
        ? `Trying again ${formatWait(record.nextAttemptAt - now)}`
        : 'Waiting for a connection';
  }
}

/** Failed first — those need a person — then in flight, then waiting, then sent. */
const ORDER: Record<QueueState, number> = {
  failed: 0,
  sending: 1,
  pending: 2,
  done: 3,
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
      // Retrying something already in flight would send it twice.
      canRetry: record.state === 'failed' || record.state === 'pending',
      canDiscard:
        record.state === 'failed' &&
        (record.queue === 'outbox' || record.attachmentId === null),
      ...(record.queue === 'uploads' ? { progress: record.progress } : {}),
    }));
}

export interface QueueSummaryCounts {
  waiting: number;
  sending: number;
  failed: number;
}

export function summarizeQueue(records: readonly QueueRecord[]): QueueSummaryCounts {
  return {
    waiting: records.filter((r) => r.state === 'pending').length,
    sending: records.filter((r) => r.state === 'sending').length,
    failed: records.filter((r) => r.state === 'failed').length,
  };
}

/**
 * What goes on the tab. `undefined` rather than 0 — react-navigation draws a
 * badge for any defined value, and an empty circle over "Queue" reads as a
 * problem where there is none.
 */
export function tabBadge(counts: QueueSummaryCounts): string | undefined {
  const outstanding = counts.waiting + counts.sending + counts.failed;
  if (!outstanding) return undefined;
  return outstanding > 9 ? '9+' : String(outstanding);
}
