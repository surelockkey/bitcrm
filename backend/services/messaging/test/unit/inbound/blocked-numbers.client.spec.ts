import { BLOCKED_NUMBERS_TTL_MS, BlockedNumbersClient } from '../../../src/inbound/blocked-numbers.client';

/** A `fetch` that answers from a script of `{ status, body }` (or throws). */
function fakeFetch(script: Array<{ status: number; body?: unknown } | Error>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  let i = 0;
  const fetchImpl = jest.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const next = script[i++] ?? { status: 200, body: { data: [] } };
    if (next instanceof Error) throw next;
    return { ok: next.status < 400, status: next.status, json: async () => next.body } as unknown as Response;
  });
  return { fetchImpl, calls };
}

/**
 * Telephony owns the block list (Workiz Phone → Blocked callers); messaging
 * reads it over the internal route so a text from a blocked number is dropped
 * like its calls are. Cached, stale on error, and fail-open: a telephony
 * outage must never make every inbound text vanish.
 */
describe('BlockedNumbersClient', () => {
  it('reads the internal listing with the service secret and caches it for 60 s', async () => {
    const { fetchImpl, calls } = fakeFetch([{ status: 200, body: { data: ['+12147917112'] } }]);
    const client = new BlockedNumbersClient(fetchImpl);

    expect(await client.isBlocked('+12147917112', 1_000)).toBe(true);
    expect(await client.isBlocked('+15550000000', 1_000)).toBe(false);
    expect(calls[0].url).toMatch(/\/api\/telephony\/blocked-callers\/internal\/numbers$/);
    expect((calls[0].init?.headers as Record<string, string>)['x-internal-secret']).toBeDefined();

    expect(await client.isBlocked('+12147917112', 1_000 + BLOCKED_NUMBERS_TTL_MS - 1)).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await client.isBlocked('+12147917112', 1_000 + BLOCKED_NUMBERS_TTL_MS + 1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('matches the sender however the row was written', async () => {
    const client = new BlockedNumbersClient(fakeFetch([{ status: 200, body: { data: ['+12147917112'] } }]).fetchImpl);
    expect(await client.isBlocked('(214) 791-7112')).toBe(true);
    expect(await client.isBlocked('')).toBe(false);
  });

  it('blocks nobody before the first success or on an error, and keeps the last good list', async () => {
    const { fetchImpl } = fakeFetch([
      new Error('ECONNREFUSED'),
      { status: 200, body: { data: ['+12147917112'] } },
      { status: 503 },
    ]);
    const client = new BlockedNumbersClient(fetchImpl);
    expect(await client.isBlocked('+12147917112', 0)).toBe(false); // nothing known yet → fail open
    expect(await client.isBlocked('+12147917112', 0)).toBe(true);
    expect(await client.isBlocked('+12147917112', BLOCKED_NUMBERS_TTL_MS + 1)).toBe(true); // 503 → stale answer
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});
