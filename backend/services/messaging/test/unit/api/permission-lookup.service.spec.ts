import { PermissionLookupService } from '../../../src/api/access/permission-lookup.service';
import { ADMIN, adminPerms } from './api-mocks';

function make(cached: unknown = null, fetched: unknown = null) {
  const cacheReader = { getPermissions: jest.fn().mockResolvedValue(cached) };
  const fetchImpl = jest.fn().mockResolvedValue(fetched);
  const svc = new PermissionLookupService(cacheReader as never, fetchImpl);
  return { svc, cacheReader, fetchImpl };
}

describe('PermissionLookupService', () => {
  it('answers from the Redis cache without calling user-service', async () => {
    const perms = adminPerms();
    const { svc, cacheReader, fetchImpl } = make(perms);
    expect(await svc.resolve(ADMIN)).toBe(perms);
    expect(cacheReader.getPermissions).toHaveBeenCalledWith('admin-1', 'role-admin');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('falls back to user-service on a cache miss and memoises the answer', async () => {
    const perms = adminPerms();
    const { svc, fetchImpl } = make(null, perms);
    expect(await svc.resolve(ADMIN)).toBe(perms);
    expect(fetchImpl).toHaveBeenCalledWith(expect.stringContaining('http'), 'admin-1');
    await svc.resolve(ADMIN);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('resolves null (memoised) when both fail or throw, and for an anonymous caller', async () => {
    const { svc } = make(null, null);
    expect(await svc.resolve(ADMIN)).toBeNull();

    const throwing = { getPermissions: jest.fn().mockRejectedValue(new Error('redis down')) };
    const s2 = new PermissionLookupService(throwing as never, jest.fn());
    expect(await s2.resolve(ADMIN)).toBeNull();
    expect(await s2.resolve(ADMIN)).toBeNull();
    expect(throwing.getPermissions).toHaveBeenCalledTimes(1);

    expect(await svc.resolve(undefined)).toBeNull();
  });
});
