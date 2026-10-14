/* eslint-disable @typescript-eslint/no-explicit-any */
import { DealClient } from 'src/integrations/deal.client';

/**
 * Contract K1 — deal-service's `POST /api/deals/internal/by-ids` (internal
 * secret, `{ ids }` ≤ 500, `{ success, data: Deal[] }`, missing ids omitted).
 * It replaces the Payments report's call to the PUBLIC `POST /deals/by-ids`
 * on the user's bearer (a second auth round inside deal-service). A
 * deal-service from before it answers 404 → `null`, and the caller falls back.
 */
describe('DealClient.getDealsByIdsInternal (K1)', () => {
  const ok = (data: unknown) => ({ ok: true, status: 200, json: async () => ({ success: true, data }) });
  const notFound = { ok: false, status: 404, json: async () => ({ success: false }) };
  const answerIds = jest.fn(async (_url: string, init: any) => {
    const { ids } = JSON.parse(init.body) as { ids: string[] };
    return ok(ids.filter((id) => !id.startsWith('gone')).map((id) => ({ id, dealNumber: `J-${id}`, status: 'active' })));
  });

  beforeEach(() => answerIds.mockClear());

  it('posts the ids to the internal route with the internal secret — no bearer', async () => {
    const client = new DealClient(answerIds as any);
    const deals = await client.getDealsByIdsInternal(['d1', 'gone-1', 'd2']);
    expect(deals?.map((d) => d.id)).toEqual(['d1', 'd2']);
    const [url, init] = answerIds.mock.calls[0] as [string, any];
    expect(url).toMatch(/\/api\/deals\/internal\/by-ids$/);
    expect(init.method).toBe('POST');
    expect(init.headers['x-internal-secret']).toBeDefined();
    expect(init.headers.authorization).toBeUndefined();
    expect(JSON.parse(init.body)).toEqual({ ids: ['d1', 'gone-1', 'd2'] });
  });

  it('asks at most 500 ids per call, and de-duplicates', async () => {
    const client = new DealClient(answerIds as any);
    const ids = Array.from({ length: 1100 }, (_, i) => `d${i}`);
    const deals = await client.getDealsByIdsInternal([...ids, 'd1', 'd2']);
    expect(deals).toHaveLength(1100);
    const sizes = answerIds.mock.calls.map((c) => JSON.parse((c[1] as any).body).ids.length);
    expect(sizes).toEqual([500, 500, 100]);
  });

  it('caches the deals it found for 60 s: a repeat asks only for the ids it has not seen', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-13T12:00:00.000Z') });
    try {
      const client = new DealClient(answerIds as any);
      await client.getDealsByIdsInternal(['d1', 'd2']);
      const again = await client.getDealsByIdsInternal(['d2', 'd1', 'd3']);
      expect(again?.map((d) => d.id).sort()).toEqual(['d1', 'd2', 'd3']);
      expect(JSON.parse((answerIds.mock.calls[1][1] as any).body)).toEqual({ ids: ['d3'] });

      await client.getDealsByIdsInternal(['d1', 'd2', 'd3']);
      expect(answerIds).toHaveBeenCalledTimes(2);

      jest.setSystemTime(new Date('2026-10-13T12:01:01.000Z'));
      await client.getDealsByIdsInternal(['d1']);
      expect(answerIds).toHaveBeenCalledTimes(3);
    } finally {
      jest.useRealTimers();
    }
  });

  it('answers null on 404 (deal-service without K1) and does not ask again for a minute', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-13T12:00:00.000Z') });
    try {
      const fetchImpl = jest.fn(async () => notFound);
      const client = new DealClient(fetchImpl as any);
      await expect(client.getDealsByIdsInternal(['d1'])).resolves.toBeNull();
      await expect(client.getDealsByIdsInternal(['d2'])).resolves.toBeNull();
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      jest.setSystemTime(new Date('2026-10-13T12:01:01.000Z'));
      await client.getDealsByIdsInternal(['d2']);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it('an empty id list costs nothing', async () => {
    const client = new DealClient(answerIds as any);
    await expect(client.getDealsByIdsInternal([])).resolves.toEqual([]);
    expect(answerIds).not.toHaveBeenCalled();
  });
});

/**
 * The job's Payments tab and its Payment schedule are opened together and
 * both start with the job's billing view: concurrent reads of the SAME job
 * share one request. Nothing is kept once it answers — the access check
 * always sees a view that was read for this request or a concurrent one.
 */
describe('DealClient.getBillingView — single-flight, no cache', () => {
  it('concurrent reads of one job share a request; the next read asks again', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const fetchImpl = jest.fn(async (url: string) => {
      await gate;
      const id = /internal\/([^/]+)\/billing-view/.exec(url)![1];
      return ok({ deal: { id }, items: [], totals: {} });
    });
    const client = new DealClient(fetchImpl as any);
    const both = Promise.all([client.getBillingView('d1'), client.getBillingView('d1'), client.getBillingView('d2')]);
    release();
    const [a, b, c] = await both;
    expect(a?.deal.id).toBe('d1');
    expect(b?.deal.id).toBe('d1');
    expect(c?.deal.id).toBe('d2');
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    await client.getBillingView('d1');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('a failure reaches every waiter and is not kept', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({ success: false }) })
      .mockResolvedValueOnce(ok({ deal: { id: 'd1' }, items: [], totals: {} }));
    const client = new DealClient(fetchImpl as any);
    const results = await Promise.allSettled([client.getBillingView('d1'), client.getBillingView('d1')]);
    expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected']);
    await expect(client.getBillingView('d1')).resolves.toMatchObject({ deal: { id: 'd1' } });
  });

  function ok(data: unknown) {
    return { ok: true, status: 200, json: async () => ({ success: true, data }) };
  }
});
