import type { OutboxRecord, QueueRecord, UploadRecord } from '../../lib/queue/types';
import {
  describeQueue,
  formatWait,
  QUEUE_TICK_FAR_MS,
  QUEUE_TICK_NEAR_MS,
  queueTickInterval,
  summarizeQueue,
  tabBadge,
} from './lib';

const NOW = 1_700_000_000_000;

const action = (over: Partial<OutboxRecord> = {}): QueueRecord => ({
  queue: 'outbox',
  id: 'r1',
  userId: 'tech-1',
  kind: 'arrived',
  dealId: 'd1',
  payload: '{}',
  createdAt: NOW - 1_000,
  attempts: 0,
  nextAttemptAt: NOW,
  lastError: null,
  state: 'pending',
  ...over,
});

const upload = (over: Partial<UploadRecord> = {}): QueueRecord => ({
  queue: 'uploads',
  id: 'u1',
  userId: 'tech-1',
  dealId: 'd1',
  localUri: 'file:///a.jpg',
  fileName: 'job-K4T9ZW-2026-09-16.jpg',
  contentType: 'image/jpeg',
  size: 1024,
  category: null,
  attachmentId: null,
  uploadUrl: null,
  uploadHeaders: null,
  progress: 0,
  attempts: 0,
  nextAttemptAt: NOW,
  lastError: null,
  state: 'pending',
  createdAt: NOW - 1_000,
  ...over,
});

describe('formatWait', () => {
  it('reads like a person would say it', () => {
    expect(formatWait(0)).toBe('now');
    expect(formatWait(20_000)).toBe('in under a minute');
    expect(formatWait(120_000)).toBe('in 2 min');
    expect(formatWait(3 * 60 * 60 * 1000)).toBe('in 3 hours');
    expect(formatWait(60 * 60 * 1000)).toBe('in 1 hour');
  });
});

describe('describeQueue', () => {
  it('names every kind of action in words, not codes', () => {
    const titles = describeQueue(
      [
        action({ id: 'a', kind: 'confirm' }),
        action({ id: 'b', kind: 'arrived' }),
        action({ id: 'c', kind: 'note' }),
        action({ id: 'd', kind: 'on_my_way' }),
        action({ id: 'e', kind: 'late' }),
        action({ id: 'f', kind: 'status', payload: '{"superStatus":"in_progress"}' }),
        action({ id: 'g', kind: 'chat', dealId: '', payload: '{"body":"door is locked"}' }),
        action({ id: 'g2', kind: 'timeclock_in', dealId: '' }),
        action({ id: 'g3', kind: 'timeclock_in', dealId: 'd1' }),
        action({ id: 'g4', kind: 'timeclock_out', dealId: '' }),
        action({
          id: 'i',
          kind: 'client_sms',
          payload: '{"contactId":"c1","body":"I am outside"}',
        }),
        action({
          id: 'j',
          kind: 'reschedule',
          payload: '{"scheduledDate":"2026-09-18","scheduledTimeSlot":"14:00-16:00"}',
        }),
        upload({ id: 'h' }),
      ],
      NOW,
    ).map((i) => i.title);

    expect(titles).toEqual([
      'Confirmed receipt',
      'Arrived',
      'Note',
      'Text: on my way',
      'Text: running late',
      'Status: In progress',
      // The two threads are never named the same way on this screen, because
      // this is where a technician goes to work out what has not gone out.
      'Message to the office',
      // A clock row is the one kind whose failure costs money, so it is named
      // as plainly as possible: a technician scanning this list has to spot it.
      'Clocked in',
      'Clocked in on a job',
      'Clocked out',
      'Photo — job-K4T9ZW-2026-09-16.jpg',
      'Text to the client',
      // Named with its destination: three moves in a morning are three rows
      // that have to be tellable apart.
      'Reschedule: Fri, Sep 18 · 2:00 PM – 4:00 PM',
    ]);
  });

  it('still names a reschedule whose payload cannot be read', () => {
    const [item] = describeQueue([action({ kind: 'reschedule', payload: 'not json' })], NOW);
    expect(item!.title).toBe('Reschedule');
  });

  it('survives a payload it cannot read rather than rendering nothing', () => {
    const [item] = describeQueue([action({ kind: 'status', payload: 'not json' })], NOW);
    expect(item!.title).toBe('Status change');
  });

  it('says a waiting row is waiting, not that it failed', () => {
    const [item] = describeQueue([action()], NOW);
    expect(item!.detail).toBe('Waiting for a connection');
  });

  it('says when a backed-off row will be tried again', () => {
    const [item] = describeQueue([action({ nextAttemptAt: NOW + 120_000 })], NOW);
    expect(item!.detail).toBe('Trying again in 2 min');
  });

  it("gives a parked row the server's own reason", () => {
    const [item] = describeQueue(
      [action({ state: 'failed', lastError: 'Job is already closed' })],
      NOW,
    );
    expect(item!.detail).toBe('Not sent: Job is already closed');
  });

  it('shows an upload’s progress while it is going', () => {
    const [item] = describeQueue([upload({ state: 'sending', progress: 0.42 })], NOW);
    expect(item!.detail).toBe('Uploading 42%');
    expect(item!.progress).toBe(0.42);
  });

  it('puts what needs a person first, and what is already sent last', () => {
    const order = describeQueue(
      [
        action({ id: 'done', state: 'done' }),
        action({ id: 'pending', state: 'pending' }),
        action({ id: 'failed', state: 'failed' }),
        action({ id: 'sending', state: 'sending' }),
      ],
      NOW,
    ).map((i) => i.id);

    expect(order).toEqual(['failed', 'sending', 'pending', 'done']);
  });

  it('never offers a retry on something already in flight', () => {
    const [item] = describeQueue([action({ state: 'sending' })], NOW);
    expect(item!.canRetry).toBe(false);
  });

  it('lets a failed row be retried', () => {
    const [item] = describeQueue([action({ state: 'failed' })], NOW);
    expect(item!.canRetry).toBe(true);
  });

  it('refuses to discard a photo the job already shows', () => {
    // Presign wrote the metadata and a timeline entry; dropping the row here
    // would leave a permanent gap nobody could explain.
    const [presigned] = describeQueue(
      [upload({ state: 'failed', attachmentId: 'att-1' })],
      NOW,
    );
    expect(presigned!.canDiscard).toBe(false);

    const [untouched] = describeQueue([upload({ state: 'failed' })], NOW);
    expect(untouched!.canDiscard).toBe(true);
  });
});

describe('summarizeQueue', () => {
  it('counts each state separately', () => {
    expect(
      summarizeQueue([
        action({ id: '1', state: 'pending' }),
        action({ id: '2', state: 'pending' }),
        action({ id: '3', state: 'sending' }),
        action({ id: '4', state: 'failed' }),
        action({ id: '5', state: 'done' }),
      ]),
    ).toEqual({ waiting: 2, sending: 1, failed: 1, unknown: 0 });
  });
});

describe('tabBadge', () => {
  it('shows nothing at all when the queue is empty', () => {
    // A zero badge over "Queue" reads as a problem where there is none.
    expect(tabBadge({ waiting: 0, sending: 0, failed: 0, unknown: 0 })).toBeUndefined();
  });

  it('counts everything outstanding', () => {
    expect(tabBadge({ waiting: 2, sending: 1, failed: 1, unknown: 0 })).toBe('4');
  });

  it('stops counting past nine', () => {
    expect(tabBadge({ waiting: 20, sending: 0, failed: 0, unknown: 0 })).toBe('9+');
  });
});

describe('queueTickInterval', () => {
  it('asks for no timer when nothing is waiting', () => {
    expect(queueTickInterval([], NOW)).toBeNull();
    expect(queueTickInterval([action({ state: 'done' })], NOW)).toBeNull();
    expect(queueTickInterval([action({ state: 'failed' })], NOW)).toBeNull();
  });

  it('ticks by the second when the next attempt is nearly due', () => {
    expect(
      queueTickInterval([action({ nextAttemptAt: NOW + 20_000 })], NOW),
    ).toBe(QUEUE_TICK_NEAR_MS);
  });

  it('ticks slowly while the wait is long', () => {
    expect(
      queueTickInterval([action({ nextAttemptAt: NOW + 14 * 60_000 })], NOW),
    ).toBe(QUEUE_TICK_FAR_MS);
  });

  it('takes its pace from the soonest row, not the last one', () => {
    expect(
      queueTickInterval(
        [
          action({ id: 'far', nextAttemptAt: NOW + 15 * 60_000 }),
          action({ id: 'near', nextAttemptAt: NOW + 5_000 }),
        ],
        NOW,
      ),
    ).toBe(QUEUE_TICK_NEAR_MS);
  });
});

describe('a row whose outcome nobody knows', () => {
  it('says so, in the server-agnostic words the recovery wrote', () => {
    const [item] = describeQueue(
      [action({ state: 'unknown', kind: 'note', lastError: 'It may already have been sent.' })],
      NOW,
    );
    expect(item!.detail).toBe('It may already have been sent.');
  });

  it('offers both ways out: send it again, or say it is already there', () => {
    const [item] = describeQueue([action({ state: 'unknown', kind: 'note' })], NOW);
    expect(item!.canRetry).toBe(true);
    expect(item!.canDiscard).toBe(true);
  });

  it('sorts above everything else — it is the one that needs a decision', () => {
    const items = describeQueue(
      [
        action({ id: 'failed', state: 'failed' }),
        action({ id: 'pending', state: 'pending' }),
        action({ id: 'unknown', state: 'unknown' }),
      ],
      NOW,
    );
    expect(items.map((i) => i.id)).toEqual(['unknown', 'failed', 'pending']);
  });

  it('counts towards the tab badge — it is outstanding work', () => {
    expect(summarizeQueue([action({ state: 'unknown' })]).unknown).toBe(1);
    expect(tabBadge({ waiting: 0, sending: 0, failed: 0, unknown: 1 })).toBe('1');
  });
});
