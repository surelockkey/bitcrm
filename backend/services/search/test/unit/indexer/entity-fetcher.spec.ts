import { EntityFetcher, UnsupportedEntityError } from 'src/indexer/entity-fetcher.service';

/** A `fetch` answering from a routing table keyed by URL substring; unknown URLs 404. */
function mockFetch(routes: Record<string, { status?: number; body?: unknown }>) {
  return jest.fn(async (url: string, init: { headers?: Record<string, string> } = {}) => {
    void init;
    const key = Object.keys(routes).find((k) => url.includes(k));
    const route = key ? routes[key] : { status: 404 };
    const status = route.status ?? 200;
    return { ok: status >= 200 && status < 300, status, json: async () => route.body };
  });
}

describe('EntityFetcher', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('reads a conversation from messaging\'s internal route and unwraps the envelope', async () => {
    const fetchImpl = mockFetch({
      '/api/messaging/conversations/internal/cv1': { body: { success: true, data: { id: 'cv1', kind: 'client' } } },
    });
    global.fetch = fetchImpl as any;

    const entity = await new EntityFetcher().fetch('conversation', 'cv1');
    expect(entity).toEqual({ id: 'cv1', kind: 'client' });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toMatch(/\/api\/messaging\/conversations\/internal\/cv1$/);
    expect(init?.headers).toHaveProperty('x-internal-secret');
  });

  it('answers null for a conversation that no longer exists', async () => {
    global.fetch = mockFetch({}) as any;
    expect(await new EntityFetcher().fetch('conversation', 'gone')).toBeNull();
  });

  it('reads the latest messages with the requested limit and tolerates every page shape', async () => {
    const lines = [{ id: 'm2' }, { id: 'm1' }];
    for (const body of [
      { success: true, data: lines, pagination: { count: 2 } },
      { success: true, data: { items: lines } },
      lines,
    ]) {
      const fetchImpl = mockFetch({ '/conversations/internal/cv1/messages': { body } });
      global.fetch = fetchImpl as any;
      expect(await new EntityFetcher().fetchConversationMessages('cv1', 20)).toEqual(lines);
      expect(String(fetchImpl.mock.calls[0][0])).toMatch(/\/conversations\/internal\/cv1\/messages\?limit=20$/);
    }
  });

  it('treats a 404 feed as empty and any other failure as an error', async () => {
    global.fetch = mockFetch({}) as any;
    expect(await new EntityFetcher().fetchConversationMessages('gone', 20)).toEqual([]);

    global.fetch = mockFetch({ '/messages': { status: 503 } }) as any;
    await expect(new EntityFetcher().fetchConversationMessages('cv1', 20)).rejects.toThrow(/HTTP 503/);
  });

  it('still refuses types without a single-entity endpoint', async () => {
    await expect(new EntityFetcher().fetch('technician', 't1')).rejects.toBeInstanceOf(UnsupportedEntityError);
  });
});
