import { ContactsCacheService } from 'src/contacts/contacts-cache.service';
import { CompaniesCacheService } from 'src/companies/companies-cache.service';

/** A closed Redis is a cache miss, never a 500 (the deploy bursts of Oct 2026). */
const closed = () => {
  const fail = jest.fn(async () => {
    throw new Error('Connection is closed.');
  });
  return { client: { get: fail, set: fail, del: fail, mget: fail, pipeline: () => ({ set: jest.fn(), exec: fail }) } };
};

describe('crm caches fail open', () => {
  it('contacts: reads miss, writes and invalidations are dropped', async () => {
    const cache = new ContactsCacheService(closed() as never);
    await expect(cache.get('c1')).resolves.toBeNull();
    await expect(cache.getMany(['c1', 'c2'])).resolves.toEqual(new Map());
    await expect(cache.set({ id: 'c1' } as never)).resolves.toBeUndefined();
    await expect(cache.setMany([{ id: 'c1' } as never])).resolves.toBeUndefined();
    await expect(cache.invalidate('c1')).resolves.toBeUndefined();
  });

  it('companies: reads miss, writes and invalidations are dropped', async () => {
    const cache = new CompaniesCacheService(closed() as never);
    await expect(cache.get('co1')).resolves.toBeNull();
    await expect(cache.set({ id: 'co1' } as never)).resolves.toBeUndefined();
    await expect(cache.invalidate('co1')).resolves.toBeUndefined();
  });
});
