import type { OutboxRecord, QueueRecord, UploadRecord } from '../../lib/queue/types';
import {
  describeQueue,
  formatWait,
  summarizeQueue,
  tabBadge,
} from './lib';

const NOW = 1_700_000_000_000;

const action = (over: Partial<OutboxRecord> = {}): QueueRecord => ({
  queue: 'outbox',
  id: 'r1',
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
        upload({ id: 'g' }),
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
      'Photo — job-K4T9ZW-2026-09-16.jpg',
    ]);
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
    ).toEqual({ waiting: 2, sending: 1, failed: 1 });
  });
});

describe('tabBadge', () => {
  it('shows nothing at all when the queue is empty', () => {
    // A zero badge over "Queue" reads as a problem where there is none.
    expect(tabBadge({ waiting: 0, sending: 0, failed: 0 })).toBeUndefined();
  });

  it('counts everything outstanding', () => {
    expect(tabBadge({ waiting: 2, sending: 1, failed: 1 })).toBe('4');
  });

  it('stops counting past nine', () => {
    expect(tabBadge({ waiting: 20, sending: 0, failed: 0 })).toBe('9+');
  });
});
