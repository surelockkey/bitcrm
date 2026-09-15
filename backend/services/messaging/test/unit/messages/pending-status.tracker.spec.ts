import { PENDING_STATUS_CAPACITY, PendingStatusTracker, pendingStatusId } from '../../../src/messages/pending-status.tracker';
import { T1 } from '../mocks';

const key = (n: number) => ({ conversationId: 'c1', createdAt: T1, messageId: `m${n}` });
const T = Date.parse('2026-09-15T12:00:00.000Z');

describe('PendingStatusTracker', () => {
  it('remembers a key once, with its tracking time, and forgets it on demand', () => {
    const tracker = new PendingStatusTracker();
    tracker.track(key(1), T);
    tracker.track(key(1), T + 5_000);
    expect(tracker.size).toBe(1);
    expect(tracker.has(key(1))).toBe(true);
    expect(tracker.due(T)).toEqual([{ key: key(1), trackedAt: T, nextAt: T, attempts: 0 }]);
    tracker.forget(key(1));
    expect(tracker.size).toBe(0);
    expect(tracker.due(T + 1)).toEqual([]);
  });

  it('due = at least minAge old and past the back-off, oldest first', () => {
    const tracker = new PendingStatusTracker();
    tracker.track(key(1), T);
    tracker.track(key(2), T + 30_000);
    expect(tracker.due(T + 59_000, 60_000)).toEqual([]);
    expect(tracker.due(T + 60_000, 60_000).map((e) => e.key.messageId)).toEqual(['m1']);
    expect(tracker.due(T + 90_000, 60_000).map((e) => e.key.messageId)).toEqual(['m1', 'm2']);

    tracker.defer(key(1), T + 200_000);
    expect(tracker.due(T + 90_000, 60_000).map((e) => e.key.messageId)).toEqual(['m2']);
    expect(tracker.due(T + 200_000, 60_000).map((e) => e.key.messageId)).toEqual(['m1', 'm2']);
    expect(tracker.due(T + 200_000).find((e) => e.key.messageId === 'm1')).toMatchObject({ attempts: 1, nextAt: T + 200_000 });
    tracker.defer(key(9), T); // unknown: nothing happens
    expect(tracker.size).toBe(2);
  });

  it('is bounded: past the capacity the oldest entry goes first', () => {
    const tracker = new PendingStatusTracker();
    for (let i = 0; i < PENDING_STATUS_CAPACITY + 2; i++) tracker.track(key(i), T + i);
    expect(tracker.size).toBe(PENDING_STATUS_CAPACITY);
    expect(tracker.has(key(0))).toBe(false);
    expect(tracker.has(key(1))).toBe(false);
    expect(tracker.has(key(2))).toBe(true);
    expect(tracker.has(key(PENDING_STATUS_CAPACITY + 1))).toBe(true);
  });

  it('keys on the full message key, not the id alone', () => {
    expect(pendingStatusId({ conversationId: 'c1', createdAt: T1, messageId: 'm1' })).toBe(`c1|${T1}|m1`);
    const tracker = new PendingStatusTracker();
    tracker.track({ conversationId: 'c1', createdAt: T1, messageId: 'm1' }, T);
    tracker.track({ conversationId: 'c2', createdAt: T1, messageId: 'm1' }, T);
    expect(tracker.size).toBe(2);
  });
});
