import { ProductsCacheService } from 'src/products/products-cache.service';

/** A closed Redis is a cache miss, never a 500 (the deploy bursts of Oct 2026). */
describe('ProductsCacheService fails open', () => {
  it('reads miss, writes and invalidations are dropped', async () => {
    const fail = jest.fn(async () => {
      throw new Error('Connection is closed.');
    });
    const cache = new ProductsCacheService({ client: { get: fail, set: fail, del: fail, mget: fail } } as never);
    await expect(cache.get('p1')).resolves.toBeNull();
    await expect(cache.getMany(['p1'])).resolves.toEqual(new Map());
    await expect(cache.set('p1', { id: 'p1' } as never)).resolves.toBeUndefined();
    await expect(cache.invalidate('p1')).resolves.toBeUndefined();
  });
});
