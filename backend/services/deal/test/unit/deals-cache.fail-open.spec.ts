import { DealsCacheService } from 'src/deals/deals-cache.service';

/** A closed Redis is a cache miss, never a 500 (the deploy bursts of Oct 2026). */
describe('DealsCacheService fails open', () => {
  const fail = jest.fn(async () => {
    throw new Error('Connection is closed.');
  });
  const events = { dealChanged: jest.fn() };
  const cache = new DealsCacheService({ client: { get: fail, set: fail, del: fail, incr: fail } } as never, events as never);

  it('reads miss and writes are dropped', async () => {
    await expect(cache.get('d1')).resolves.toBeNull();
    await expect(cache.getJson('k')).resolves.toBeNull();
    await expect(cache.set({ id: 'd1' } as never)).resolves.toBeUndefined();
    await expect(cache.setJson('k', 1, 10)).resolves.toBeUndefined();
  });

  it('an invalidation still tells open browsers about the write', async () => {
    await expect(cache.invalidate('d1')).resolves.toBeUndefined();
    expect(events.dealChanged).toHaveBeenCalledWith('d1');
  });
});
