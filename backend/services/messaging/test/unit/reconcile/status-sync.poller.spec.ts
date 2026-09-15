import { type Message } from '@bitcrm/types';
import { PendingStatusTracker } from '../../../src/messages/pending-status.tracker';
import { loadReconcileConfig } from '../../../src/reconcile/reconcile.config';
import { type MessageSyncResult, type ReconcileService } from '../../../src/reconcile/reconcile.service';
import {
  STATUS_SYNC_MAX_AGE_MS,
  STATUS_SYNC_MAX_BACKOFF_MS,
  STATUS_SYNC_MIN_AGE_MS,
  StatusSyncPoller,
} from '../../../src/reconcile/status-sync.poller';
import { createMockMessage, T1 } from '../mocks';

const T = Date.parse('2026-09-15T12:00:00.000Z');
const key = (n: number) => ({ conversationId: 'c1', createdAt: T1, messageId: `m${n}` });
const line = (status: Message['status']): Message => createMockMessage({ direction: 'outbound', status, providerSid: 'SM1' });

function make(opts: { seconds?: number; results?: Record<string, MessageSyncResult | Error> } = {}) {
  const pending = new PendingStatusTracker();
  const syncMessage = jest.fn(async (k: { messageId: string }): Promise<MessageSyncResult> => {
    const r = opts.results?.[k.messageId];
    if (r instanceof Error) throw r;
    return r ?? { outcome: 'synced', message: line('delivered'), providerStatus: 'delivered' };
  });
  const reconcile = { syncMessage } as unknown as ReconcileService;
  const poller = new StatusSyncPoller(reconcile, pending, { statusSyncIntervalSeconds: opts.seconds ?? 30 });
  return { poller, pending, syncMessage };
}

describe('loadReconcileConfig', () => {
  it('reads the interval, off by default and on anything that is not a positive number', () => {
    expect(loadReconcileConfig({})).toEqual({ statusSyncIntervalSeconds: 0 });
    expect(loadReconcileConfig({ MESSAGING_STATUS_SYNC_INTERVAL_SECONDS: '30' })).toEqual({ statusSyncIntervalSeconds: 30 });
    expect(loadReconcileConfig({ MESSAGING_STATUS_SYNC_INTERVAL_SECONDS: '0' })).toEqual({ statusSyncIntervalSeconds: 0 });
    expect(loadReconcileConfig({ MESSAGING_STATUS_SYNC_INTERVAL_SECONDS: '-5' })).toEqual({ statusSyncIntervalSeconds: 0 });
    expect(loadReconcileConfig({ MESSAGING_STATUS_SYNC_INTERVAL_SECONDS: 'soon' })).toEqual({ statusSyncIntervalSeconds: 0 });
  });
});

describe('StatusSyncPoller — the interval', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('stays off at 0 (the default): no timer, nothing asked of Twilio', () => {
    const { poller, pending, syncMessage } = make({ seconds: 0 });
    pending.track(key(1), Date.now() - 10 * 60_000);
    poller.onModuleInit();
    expect(poller.enabled).toBe(false);
    jest.advanceTimersByTime(10 * 60_000);
    expect(syncMessage).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
    poller.onModuleDestroy();
  });

  it('when set, runs a pass every interval and stops on module destroy', async () => {
    jest.setSystemTime(T);
    const { poller, pending, syncMessage } = make({ seconds: 30 });
    pending.track(key(1), T - 2 * STATUS_SYNC_MIN_AGE_MS);
    poller.onModuleInit();
    expect(poller.enabled).toBe(true);

    await jest.advanceTimersByTimeAsync(29_000);
    expect(syncMessage).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1_000);
    expect(syncMessage).toHaveBeenCalledTimes(1);
    expect(syncMessage).toHaveBeenCalledWith(key(1), expect.any(Date));

    poller.onModuleDestroy();
    await jest.advanceTimersByTimeAsync(120_000);
    expect(syncMessage).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });
});

describe('StatusSyncPoller.tick — the set', () => {
  it('asks only about lines at least 60 s old and drops the ones that came back terminal', async () => {
    const { poller, pending, syncMessage } = make({
      results: {
        m1: { outcome: 'synced', message: line('delivered'), providerStatus: 'delivered' },
        m2: { outcome: 'synced', message: line('failed'), providerStatus: 'failed' },
      },
    });
    pending.track(key(1), T - STATUS_SYNC_MIN_AGE_MS);
    pending.track(key(2), T - 5 * 60_000);
    pending.track(key(3), T - STATUS_SYNC_MIN_AGE_MS + 1); // one ms too young
    pending.track(key(4), T);

    const pass = await poller.tick(new Date(T));
    expect(pass).toEqual({ checked: 2, synced: 2, dropped: 2, failed: 0 });
    expect(syncMessage.mock.calls.map((c) => c[0].messageId)).toEqual(['m1', 'm2']);
    expect(pending.has(key(1))).toBe(false);
    expect(pending.has(key(2))).toBe(false);
    expect(pending.has(key(3))).toBe(true);
    expect(pending.has(key(4))).toBe(true);
  });

  it('keeps a line still short of a terminal status and backs off: interval, then ×2, capped at an hour', async () => {
    const { poller, pending, syncMessage } = make({
      seconds: 30,
      results: { m1: { outcome: 'unchanged', message: line('sent'), providerStatus: 'sent' } },
    });
    pending.track(key(1), T - STATUS_SYNC_MIN_AGE_MS);

    expect(await poller.tick(new Date(T))).toEqual({ checked: 1, synced: 0, dropped: 0, failed: 0 });
    expect(pending.has(key(1))).toBe(true);
    // deferred by one interval: not due at T + 29 s, due at T + 30 s
    expect(await poller.tick(new Date(T + 29_000))).toMatchObject({ checked: 0 });
    expect(await poller.tick(new Date(T + 30_000))).toMatchObject({ checked: 1 });
    // second deferral doubles: 60 s
    expect(await poller.tick(new Date(T + 30_000 + 59_000))).toMatchObject({ checked: 0 });
    expect(await poller.tick(new Date(T + 30_000 + 60_000))).toMatchObject({ checked: 1 });
    expect(syncMessage).toHaveBeenCalledTimes(3);

    // the ceiling: after many attempts the gap is one hour, never more
    for (let i = 0; i < 10; i++) pending.defer(key(1), T);
    await poller.tick(new Date(T + 10 * 60 * 60_000));
    const entry = pending.due(Number.MAX_SAFE_INTEGER)[0];
    expect(entry.nextAt - (T + 10 * 60 * 60_000)).toBe(STATUS_SYNC_MAX_BACKOFF_MS);
  });

  it('forgets a line that is gone, not syncable, or older than a day; keeps one whose lookup failed', async () => {
    const { poller, pending } = make({
      results: {
        m1: { outcome: 'not_found' },
        m2: { outcome: 'not_syncable', message: line('sent') },
        m3: { outcome: 'unchanged', message: line('sent'), providerStatus: 'sent' },
        m4: new Error('Twilio 503'),
        m5: { outcome: 'no_provider_sid', message: createMockMessage({ direction: 'outbound', status: 'sending', providerSid: undefined }) },
      },
    });
    pending.track(key(1), T - 2 * 60_000);
    pending.track(key(2), T - 2 * 60_000);
    pending.track(key(3), T - STATUS_SYNC_MAX_AGE_MS - 1);
    pending.track(key(4), T - 2 * 60_000);
    pending.track(key(5), T - 2 * 60_000);

    const pass = await poller.tick(new Date(T));
    expect(pass).toEqual({ checked: 5, synced: 0, dropped: 3, failed: 1 });
    expect(pending.has(key(1))).toBe(false);
    expect(pending.has(key(2))).toBe(false);
    expect(pending.has(key(3))).toBe(false);
    expect(pending.has(key(4))).toBe(true);
    expect(pending.has(key(5))).toBe(true); // the worker may still be writing the sid
  });

  it('drops a line older than a day even when its lookup keeps throwing; a younger one that threw is kept and backed off', async () => {
    const { poller, pending, syncMessage } = make({ results: { m1: new Error('Twilio 503'), m2: new Error('Twilio 503') } });
    pending.track(key(1), T - STATUS_SYNC_MAX_AGE_MS - 1);
    pending.track(key(2), T - STATUS_SYNC_MAX_AGE_MS); // exactly a day: not past the ceiling yet

    const pass = await poller.tick(new Date(T));
    expect(pass).toEqual({ checked: 2, synced: 0, dropped: 1, failed: 2 });
    expect(syncMessage).toHaveBeenCalledTimes(2);
    expect(pending.has(key(1))).toBe(false);
    expect(pending.has(key(2))).toBe(true);
    expect(pending.due(T)).toEqual([]); // deferred by the back-off, not left due

    // next pass: the kept one is past the ceiling now and goes too, still failing
    expect(await poller.tick(new Date(T + STATUS_SYNC_MAX_BACKOFF_MS))).toEqual({ checked: 1, synced: 0, dropped: 1, failed: 1 });
    expect(pending.size).toBe(0);
  });

  it('does not overlap two passes', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { poller, pending, syncMessage } = make();
    syncMessage.mockImplementationOnce(async () => {
      await gate;
      return { outcome: 'synced', message: line('delivered'), providerStatus: 'delivered' };
    });
    pending.track(key(1), T - 2 * 60_000);

    const first = poller.tick(new Date(T));
    const second = await poller.tick(new Date(T));
    expect(second).toEqual({ checked: 0, synced: 0, dropped: 0, failed: 0 });
    release();
    expect(await first).toMatchObject({ checked: 1, synced: 1 });
    expect(syncMessage).toHaveBeenCalledTimes(1);
  });
});
