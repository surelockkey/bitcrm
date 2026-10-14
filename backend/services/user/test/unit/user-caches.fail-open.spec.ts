import { UsersCacheService } from 'src/users/users-cache.service';
import { TechniciansCacheService } from 'src/technicians/technicians-cache.service';

/** A closed Redis is a cache miss, never a 500 (the deploy bursts of Oct 2026). */
describe('user caches fail open', () => {
  const fail = jest.fn(async () => {
    throw new Error('Connection is closed.');
  });
  const redis = { client: { get: fail, set: fail, del: fail } } as never;

  it('users', async () => {
    const cache = new UsersCacheService(redis);
    await expect(cache.getUser('u1')).resolves.toBeNull();
    await expect(cache.setUser({ id: 'u1' } as never)).resolves.toBeUndefined();
    await expect(cache.invalidateUser('u1')).resolves.toBeUndefined();
  });

  it('technician profiles', async () => {
    const cache = new TechniciansCacheService(redis);
    await expect(cache.getProfile('u1')).resolves.toBeNull();
    await expect(cache.setProfile({ userId: 'u1' } as never)).resolves.toBeUndefined();
    await expect(cache.invalidateProfile('u1')).resolves.toBeUndefined();
  });
});
