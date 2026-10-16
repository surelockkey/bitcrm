import { EXPO_PUSH_URL, ExpoPushClient, isDeviceNotRegistered, type ExpoPushMessage } from '../../../src/push/expo-push.client';

const msg = (i: number): ExpoPushMessage => ({ to: `ExponentPushToken[t${i}]`, title: 'T', body: `B${i}`, data: { type: 'message' } });

const json = (status: number, body: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) }) as unknown as Response;

/** Answers `ok` for every message of a batch, ids `id-<n>` in order. */
function okFetch() {
  let n = 0;
  return jest.fn(async (_url: string, init?: RequestInit) => {
    const batch = JSON.parse(String(init?.body)) as unknown[];
    return json(200, { data: batch.map(() => ({ status: 'ok', id: `id-${n++}` })) });
  });
}

describe('ExpoPushClient', () => {
  it('POSTs the messages as one JSON array to the Expo push API', async () => {
    const fetchImpl = okFetch();
    const client = new ExpoPushClient({ enabled: true }, fetchImpl);

    const tickets = await client.send([msg(1), msg(2)]);

    expect(tickets).toEqual([{ status: 'ok', id: 'id-0' }, { status: 'ok', id: 'id-1' }]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(EXPO_PUSH_URL);
    expect(EXPO_PUSH_URL).toBe('https://exp.host/--/api/v2/push/send');
    expect(init).toMatchObject({ method: 'POST' });
    expect(init?.headers).toMatchObject({ 'content-type': 'application/json', accept: 'application/json' });
    expect((init?.headers as Record<string, string>).authorization).toBeUndefined();
    expect(JSON.parse(String(init?.body))).toEqual([msg(1), msg(2)]);
  });

  it('sends EXPO_ACCESS_TOKEN as a Bearer token when one is configured', async () => {
    const fetchImpl = okFetch();
    await new ExpoPushClient({ enabled: true, expoAccessToken: 'secret-1' }, fetchImpl).send([msg(1)]);
    expect(fetchImpl.mock.calls[0][1]?.headers).toMatchObject({ authorization: 'Bearer secret-1' });
  });

  it('batches at most 100 messages per request and keeps the tickets in input order', async () => {
    const fetchImpl = okFetch();
    const messages = Array.from({ length: 250 }, (_, i) => msg(i));

    const tickets = await new ExpoPushClient({ enabled: true }, fetchImpl).send(messages);

    expect(fetchImpl.mock.calls.map(([, init]) => (JSON.parse(String(init?.body)) as unknown[]).length)).toEqual([100, 100, 50]);
    expect(tickets).toHaveLength(250);
    expect(tickets[0]).toEqual({ status: 'ok', id: 'id-0' });
    expect(tickets[249]).toEqual({ status: 'ok', id: 'id-249' });
  });

  it('passes per-message errors through — DeviceNotRegistered is recognisable', async () => {
    const fetchImpl = jest.fn(async () =>
      json(200, {
        data: [
          { status: 'ok', id: 'a' },
          { status: 'error', message: '"ExponentPushToken[t2]" is not a registered push notification recipient', details: { error: 'DeviceNotRegistered', expoPushToken: 'ExponentPushToken[t2]' } },
        ],
      }),
    );
    const tickets = await new ExpoPushClient({ enabled: true }, fetchImpl).send([msg(1), msg(2)]);

    expect(isDeviceNotRegistered(tickets[0])).toBe(false);
    expect(isDeviceNotRegistered(tickets[1])).toBe(true);
  });

  it('never throws: a refused, failed or garbled batch becomes error tickets, the other batches still go', async () => {
    let call = 0;
    const fetchImpl = jest.fn(async (_url: string, init?: RequestInit) => {
      call += 1;
      if (call === 1) return json(503, { errors: [{ code: 'INTERNAL', message: 'down' }] });
      if (call === 2) throw new Error('ECONNRESET');
      if (call === 3) return json(200, { nope: true });
      const batch = JSON.parse(String(init?.body)) as unknown[];
      return json(200, { data: batch.map(() => ({ status: 'ok', id: 'x' })) });
    });
    const messages = Array.from({ length: 301 }, (_, i) => msg(i));

    const tickets = await new ExpoPushClient({ enabled: true }, fetchImpl).send(messages);

    expect(tickets).toHaveLength(301);
    expect(tickets.slice(0, 300).every((t) => t.status === 'error')).toBe(true);
    expect(tickets.slice(0, 300).some((t) => isDeviceNotRegistered(t))).toBe(false);
    expect(tickets[300]).toEqual({ status: 'ok', id: 'x' });
  });

  it('sends nothing for nothing', async () => {
    const fetchImpl = okFetch();
    expect(await new ExpoPushClient({ enabled: true }, fetchImpl).send([])).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
