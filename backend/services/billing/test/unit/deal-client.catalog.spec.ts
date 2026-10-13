/* eslint-disable @typescript-eslint/no-explicit-any */
import { DealClient } from 'src/integrations/deal.client';

/**
 * Deal-service catalogs (job types, service areas, custom fields) are cached
 * 60 s. A cold cache under a burst of requests — the Payments report fans out
 * — must cost ONE call to deal-service, not one per request; a failure is
 * never cached, so the next caller tries again.
 */
describe('DealClient catalogs — single-flight', () => {
  function fake() {
    let release!: () => void;
    let gate = new Promise<void>((r) => (release = r));
    let fail = false;
    const fetchImpl = jest.fn(async () => {
      await gate;
      if (fail) return { ok: false, status: 503, json: async () => ({ success: false }) };
      return { ok: true, status: 200, json: async () => ({ success: true, data: [{ id: 'jt-1', name: 'Rekey' }] }) };
    });
    return {
      client: new DealClient(fetchImpl as any),
      fetchImpl,
      release: () => release(),
      reset: () => (gate = new Promise<void>((r) => (release = r))),
      failNext: (v: boolean) => (fail = v),
    };
  }

  it('concurrent misses share one request', async () => {
    const f = fake();
    const all = Promise.all([f.client.listJobTypes(), f.client.listJobTypes(), f.client.listJobTypes()]);
    f.release();
    const out = await all;
    expect(f.fetchImpl).toHaveBeenCalledTimes(1);
    for (const rows of out) expect(rows).toEqual([{ id: 'jt-1', name: 'Rekey' }]);
    // …and the answer is cached.
    await f.client.listJobTypes();
    expect(f.fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('separate catalogs are separate flights', async () => {
    const f = fake();
    const all = Promise.all([f.client.listJobTypes(), f.client.listServiceAreas()]);
    f.release();
    await all;
    expect(f.fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('a failure is shared by the waiters but not cached', async () => {
    const f = fake();
    f.failNext(true);
    const all = Promise.all([f.client.listCustomFields(), f.client.listCustomFields()]);
    f.release();
    expect(await all).toEqual([[], []]);
    expect(f.fetchImpl).toHaveBeenCalledTimes(1);

    f.failNext(false);
    expect(await f.client.listCustomFields()).toEqual([{ id: 'jt-1', name: 'Rekey' }]);
    expect(f.fetchImpl).toHaveBeenCalledTimes(2);
  });
});
