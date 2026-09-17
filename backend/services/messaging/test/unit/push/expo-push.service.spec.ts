import { ExpoPushService, EXPO_BATCH_SIZE, type ExpoPushMessage } from '../../../src/push/expo-push.service';
import {
  DEFAULT_PUSH_MAX_ATTEMPTS,
  DEFAULT_PUSH_RECEIPT_DELAY_MS,
  DEFAULT_PUSH_RETRY_BASE_MS,
  DEFAULT_PUSH_TIMEOUT_MS,
  EXPO_RECEIPTS_URL,
  EXPO_SEND_URL,
  loadPushConfig,
  type PushConfig,
} from '../../../src/push/push.config';

const config = (overrides: Partial<PushConfig> = {}): PushConfig => ({
  enabled: true,
  sendUrl: EXPO_SEND_URL,
  receiptsUrl: EXPO_RECEIPTS_URL,
  timeoutMs: DEFAULT_PUSH_TIMEOUT_MS,
  maxAttempts: DEFAULT_PUSH_MAX_ATTEMPTS,
  retryBaseMs: 1,
  receiptDelayMs: DEFAULT_PUSH_RECEIPT_DELAY_MS,
  ...overrides,
});

const message = (to: string): ExpoPushMessage => ({
  to,
  title: 'New job #1001',
  body: 'Sep 20, 2026 · 9:00 AM',
  data: { kind: 'job', dealId: 'd1' },
});

/** Answers each call from a script, like `mockDynamo` does for the table. */
function mockFetch(responses: Array<{ ok?: boolean; status?: number; body?: unknown } | Error>) {
  const calls: Array<{ url: string; body: unknown; init: Record<string, any> }> = [];
  let i = 0;
  const fetchImpl = jest.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined, init: (init ?? {}) as any });
    const res = responses[i++] ?? { ok: true, body: { data: [] } };
    if (res instanceof Error) throw res;
    return {
      ok: res.ok ?? true,
      status: res.status ?? 200,
      json: async () => res.body ?? {},
    } as Response;
  });
  return { fetchImpl, calls };
}

/** The deferred sweep is several awaits deep; fake timers do not advance those. */
async function flushMicrotasks(times = 20): Promise<void> {
  for (let i = 0; i < times; i += 1) await Promise.resolve();
}

function makeService(opts: { config?: Partial<PushConfig>; responses?: Parameters<typeof mockFetch>[0] } = {}) {
  const { fetchImpl, calls } = mockFetch(opts.responses ?? []);
  const devices = { remove: jest.fn(async () => undefined) };
  const service = new ExpoPushService(config(opts.config), devices as any, fetchImpl as any);
  return { service, devices, fetchImpl, calls };
}

describe('ExpoPushService', () => {
  afterEach(() => jest.useRealTimers());

  describe('the feature flag', () => {
    it('no-ops with one log line and no HTTP call when push is off', async () => {
      const { service, fetchImpl, devices } = makeService({ config: { enabled: false } });
      const log = jest.spyOn((service as any).logger, 'log').mockImplementation(() => undefined);

      const result = await service.send([message('t1'), message('t2')]);

      expect(result).toEqual({ disabled: true, accepted: 0, failed: 0, unregistered: [], pending: [] });
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(devices.remove).not.toHaveBeenCalled();
      expect(log).toHaveBeenCalledTimes(1);
      expect(log.mock.calls[0][0]).toContain('PUSH_ENABLED');
      expect(service.enabled).toBe(false);
    });

    it('is off unless PUSH_ENABLED is exactly "true", and needs no account to be on', () => {
      expect(loadPushConfig({}).enabled).toBe(false);
      expect(loadPushConfig({ PUSH_ENABLED: '1' }).enabled).toBe(false);
      expect(loadPushConfig({ PUSH_ENABLED: 'true' }).enabled).toBe(true);
      // No token is required: Expo accepts an anonymous POST.
      expect(loadPushConfig({ PUSH_ENABLED: 'true' }).accessToken).toBeUndefined();
      expect(loadPushConfig({}).sendUrl).toBe(EXPO_SEND_URL);
    });

    it('reads its numbers from the environment and falls back on nonsense', () => {
      const c = loadPushConfig({ PUSH_TIMEOUT_MS: '2500', PUSH_MAX_ATTEMPTS: 'many', PUSH_RETRY_BASE_MS: '0' });
      expect(c.timeoutMs).toBe(2500);
      expect(c.maxAttempts).toBe(DEFAULT_PUSH_MAX_ATTEMPTS);
      expect(c.retryBaseMs).toBe(DEFAULT_PUSH_RETRY_BASE_MS);
    });

    it('does not even read receipts while disabled', async () => {
      const { service, fetchImpl } = makeService({ config: { enabled: false } });
      expect(await service.collectReceipts([{ id: 'r1', token: 't1' }])).toEqual([]);
      expect(fetchImpl).not.toHaveBeenCalled();
    });
  });

  describe('sending', () => {
    it('posts the batch to Expo and counts the tickets', async () => {
      const { service, calls } = makeService({
        responses: [{ body: { data: [{ status: 'ok', id: 'r1' }, { status: 'ok', id: 'r2' }] } }],
      });

      const result = await service.send([message('t1'), message('t2')]);

      expect(result.accepted).toBe(2);
      expect(result.failed).toBe(0);
      expect(result.pending).toEqual([
        { id: 'r1', token: 't1' },
        { id: 'r2', token: 't2' },
      ]);
      expect(calls[0].url).toBe(EXPO_SEND_URL);
      expect(calls[0].init.method).toBe('POST');
      expect(calls[0].body).toEqual([message('t1'), message('t2')]);
    });

    it('splits at Expo 100-message limit', async () => {
      const { service, calls } = makeService({
        responses: [{ body: { data: [] } }, { body: { data: [] } }],
      });

      await service.send(Array.from({ length: EXPO_BATCH_SIZE + 5 }, (_, i) => message(`t${i}`)));

      expect(calls).toHaveLength(2);
      expect((calls[0].body as unknown[]).length).toBe(EXPO_BATCH_SIZE);
      expect((calls[1].body as unknown[]).length).toBe(5);
    });

    it('sends nothing, and calls nothing, for an empty list', async () => {
      const { service, fetchImpl } = makeService();
      expect(await service.send([])).toEqual({ disabled: false, accepted: 0, failed: 0, unregistered: [], pending: [] });
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('hands every call its own result, so one caller cannot poison the next', async () => {
      // The nothing-happened answers used to be spreads of one module-level
      // object, which meant they shared its two arrays with each other and
      // with every result ever returned.
      const off = makeService({ config: { enabled: false } });
      const first = await off.service.send([message('t1')]);
      first.unregistered.push('poison');
      first.pending.push({ id: 'poison', token: 'poison' });
      expect(await off.service.send([message('t2')])).toEqual({
        disabled: true,
        accepted: 0,
        failed: 0,
        unregistered: [],
        pending: [],
      });

      const on = makeService({ responses: [{ body: { data: [{ status: 'ok', id: 'r1' }] } }] });
      (await on.service.send([])).pending.push({ id: 'poison', token: 'poison' });
      expect((await on.service.send([message('t1')])).pending).toEqual([{ id: 'r1', token: 't1' }]);
    });

    it('sends the access token only when the Expo project needs one', async () => {
      const withToken = makeService({ config: { accessToken: 'secret' }, responses: [{ body: { data: [] } }] });
      await withToken.service.send([message('t1')]);
      expect(withToken.calls[0].init.headers.authorization).toBe('Bearer secret');

      const without = makeService({ responses: [{ body: { data: [] } }] });
      await without.service.send([message('t1')]);
      expect(without.calls[0].init.headers.authorization).toBeUndefined();
    });

    it('carries an abort signal so a hung Expo cannot hold the caller open', async () => {
      const { service, calls } = makeService({ responses: [{ body: { data: [] } }] });
      await service.send([message('t1')]);
      expect(calls[0].init.signal).toBeInstanceOf(AbortSignal);
    });

    it('counts a batch failed rather than sent when Expo answers fewer tickets than messages', async () => {
      const { service } = makeService({ responses: [{ body: { data: [{ status: 'ok', id: 'r1' }] } }] });
      const result = await service.send([message('t1'), message('t2')]);
      expect(result.accepted).toBe(1);
      expect(result.failed).toBe(1);
    });

    it('gives up on a top-level Expo error without retrying', async () => {
      const { service, calls } = makeService({
        responses: [{ body: { errors: [{ message: 'malformed request' }] } }],
      });
      const result = await service.send([message('t1')]);
      expect(result.failed).toBe(1);
      expect(calls).toHaveLength(1);
    });
  });

  describe('dead tokens', () => {
    it('deletes a token Expo rejects as DeviceNotRegistered', async () => {
      const { service, devices } = makeService({
        responses: [
          {
            body: {
              data: [
                { status: 'error', message: 'not registered', details: { error: 'DeviceNotRegistered' } },
                { status: 'ok', id: 'r2' },
              ],
            },
          },
        ],
      });

      const result = await service.send([message('dead'), message('alive')]);

      expect(devices.remove).toHaveBeenCalledWith('dead');
      expect(result.unregistered).toEqual(['dead']);
      expect(result.failed).toBe(1);
      expect(result.accepted).toBe(1);
    });

    it('keeps a token rejected for any other reason — a bad message is not a dead phone', async () => {
      const { service, devices } = makeService({
        responses: [{ body: { data: [{ status: 'error', message: 'too big', details: { error: 'MessageTooBig' } }] } }],
      });

      const result = await service.send([message('t1')]);

      expect(devices.remove).not.toHaveBeenCalled();
      expect(result.unregistered).toEqual([]);
      expect(result.failed).toBe(1);
    });

    it('does not fail the send when the token could not be deleted', async () => {
      const { service, devices } = makeService({
        responses: [{ body: { data: [{ status: 'error', details: { error: 'DeviceNotRegistered' } }] } }],
      });
      devices.remove.mockRejectedValueOnce(new Error('throttled'));

      await expect(service.send([message('dead')])).resolves.toMatchObject({ failed: 1 });
    });

    it('deletes a token a later receipt reports as DeviceNotRegistered', async () => {
      const { service, devices, calls } = makeService({
        responses: [
          {
            body: {
              data: {
                r1: { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } },
                r2: { status: 'ok' },
                r3: { status: 'error', message: 'apns down', details: { error: 'MessageRateExceeded' } },
              },
            },
          },
        ],
      });

      const dropped = await service.collectReceipts([
        { id: 'r1', token: 'dead' },
        { id: 'r2', token: 'alive' },
        { id: 'r3', token: 'busy' },
      ]);

      expect(calls[0].url).toBe(EXPO_RECEIPTS_URL);
      expect(calls[0].body).toEqual({ ids: ['r1', 'r2', 'r3'] });
      expect(dropped).toEqual(['dead']);
      expect(devices.remove).toHaveBeenCalledTimes(1);
      expect(devices.remove).toHaveBeenCalledWith('dead');
    });

    it('schedules the receipt sweep for after Expo says receipts exist', async () => {
      jest.useFakeTimers();
      const { service, devices, calls } = makeService({
        responses: [
          { body: { data: [{ status: 'ok', id: 'r1' }] } },
          { body: { data: { r1: { status: 'error', details: { error: 'DeviceNotRegistered' } } } } },
        ],
      });

      await service.send([message('t1')]);
      expect(calls).toHaveLength(1);

      jest.advanceTimersByTime(DEFAULT_PUSH_RECEIPT_DELAY_MS);
      await flushMicrotasks();

      expect(calls).toHaveLength(2);
      expect(calls[1].url).toBe(EXPO_RECEIPTS_URL);
      expect(devices.remove).toHaveBeenCalledWith('t1');
    });

    it('drops pending receipt sweeps when the module goes down', async () => {
      jest.useFakeTimers();
      const { service, calls } = makeService({ responses: [{ body: { data: [{ status: 'ok', id: 'r1' }] } }] });

      await service.send([message('t1')]);
      service.onModuleDestroy();
      jest.advanceTimersByTime(DEFAULT_PUSH_RECEIPT_DELAY_MS * 2);

      expect(calls).toHaveLength(1);
    });
  });

  describe('retrying', () => {
    it('retries a 429 with backoff and keeps the tickets of the successful try', async () => {
      const { service, calls } = makeService({
        responses: [{ ok: false, status: 429 }, { body: { data: [{ status: 'ok', id: 'r1' }] } }],
      });

      const result = await service.send([message('t1')]);

      expect(calls).toHaveLength(2);
      expect(result.accepted).toBe(1);
    });

    it('retries a 5xx, then gives up at maxAttempts without failing the caller', async () => {
      const { service, calls } = makeService({
        responses: [{ ok: false, status: 503 }, { ok: false, status: 503 }, { ok: false, status: 502 }],
      });

      const result = await service.send([message('t1')]);

      expect(calls).toHaveLength(DEFAULT_PUSH_MAX_ATTEMPTS);
      expect(result.failed).toBe(1);
      expect(result.accepted).toBe(0);
    });

    it('retries a network error', async () => {
      const { service, calls } = makeService({
        responses: [new Error('socket hang up'), { body: { data: [{ status: 'ok', id: 'r1' }] } }],
      });

      expect((await service.send([message('t1')])).accepted).toBe(1);
      expect(calls).toHaveLength(2);
    });

    it('never retries a 4xx that is not a 429 — it will answer the same next time', async () => {
      const { service, calls } = makeService({ responses: [{ ok: false, status: 400 }] });

      const result = await service.send([message('t1')]);

      expect(calls).toHaveLength(1);
      expect(result.failed).toBe(1);
    });

    it('carries on with the next batch when one gives up', async () => {
      const { service } = makeService({
        config: { maxAttempts: 1 },
        responses: [
          { ok: false, status: 500 },
          { body: { data: Array.from({ length: 5 }, (_, i) => ({ status: 'ok', id: `r${i}` })) } },
        ],
      });

      const result = await service.send(Array.from({ length: EXPO_BATCH_SIZE + 5 }, (_, i) => message(`t${i}`)));

      expect(result.failed).toBe(EXPO_BATCH_SIZE);
      expect(result.accepted).toBe(5);
    });
  });
});
