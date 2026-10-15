import { PermissionLookupService } from '../../src/common/permission-lookup.service';

const user = (over: Partial<{ id: string; roleId: string }> = {}) =>
  ({
    id: 'user-1',
    cognitoSub: 'sub-1',
    email: 'tech@example.com',
    roleId: 'role-technician',
    department: 'field',
    ...over,
  }) as never;

const perms = (viewNumbers: boolean, over: Record<string, unknown> = {}) => ({
  roleId: 'role-technician',
  roleName: 'Technician',
  isSystemRole: true,
  permissions: { contacts: { view: true, view_numbers: viewNumbers } },
  dataScope: {},
  dealStageTransitions: [],
  hasOverrides: false,
  ...over,
});

describe('PermissionLookupService', () => {
  let cacheReader: { getPermissions: jest.Mock };
  let fetchImpl: jest.Mock;
  let service: PermissionLookupService;

  beforeEach(() => {
    cacheReader = { getPermissions: jest.fn() };
    fetchImpl = jest.fn();
    service = new PermissionLookupService(cacheReader as never, fetchImpl);
  });

  it('reads the grant from the Redis cache without an HTTP call', async () => {
    cacheReader.getPermissions.mockResolvedValue(perms(true));

    await expect(service.maySeeClientNumbers(user())).resolves.toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('denies when the cached role lacks the grant', async () => {
    cacheReader.getPermissions.mockResolvedValue(perms(false));

    await expect(service.maySeeClientNumbers(user())).resolves.toBe(false);
  });

  it('falls back to user-service on a cache miss', async () => {
    cacheReader.getPermissions.mockResolvedValue(null);
    fetchImpl.mockResolvedValue(perms(true));

    await expect(service.maySeeClientNumbers(user())).resolves.toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith(expect.any(String), 'user-1');
  });

  /**
   * Failing closed is the whole point: if we cannot prove the viewer may see
   * client numbers, they do not see them. A user-service outage degrades the
   * call log to masked, it does not open it.
   */
  it('denies when neither the cache nor user-service can answer', async () => {
    cacheReader.getPermissions.mockResolvedValue(null);
    fetchImpl.mockResolvedValue(null);

    await expect(service.maySeeClientNumbers(user())).resolves.toBe(false);
  });

  it('denies when the lookup throws', async () => {
    cacheReader.getPermissions.mockRejectedValue(new Error('redis is down'));

    await expect(service.maySeeClientNumbers(user())).resolves.toBe(false);
  });

  it('grants a Super Admin regardless of the matrix', async () => {
    cacheReader.getPermissions.mockResolvedValue(
      perms(false, {
        roleId: 'role-super-admin',
        roleName: 'Super Admin',
        isSystemRole: true,
        permissions: {},
      }),
    );

    await expect(service.maySeeClientNumbers(user())).resolves.toBe(true);
  });

  it('memoises per user so a burst of polls costs one lookup', async () => {
    // The softphone widget polls /calls/active every 5 seconds; resolving
    // permissions on each poll would triple the Redis traffic of the feature.
    cacheReader.getPermissions.mockResolvedValue(perms(true));

    await service.maySeeClientNumbers(user());
    await service.maySeeClientNumbers(user());
    await service.maySeeClientNumbers(user());

    expect(cacheReader.getPermissions).toHaveBeenCalledTimes(1);
  });

  it('keeps different users apart', async () => {
    cacheReader.getPermissions.mockImplementation(async (id: string) =>
      id === 'boss' ? perms(true) : perms(false),
    );

    await expect(
      service.maySeeClientNumbers(user({ id: 'boss' })),
    ).resolves.toBe(true);
    await expect(
      service.maySeeClientNumbers(user({ id: 'tech' })),
    ).resolves.toBe(false);
  });

  it('re-reads once the memo window has passed', async () => {
    cacheReader.getPermissions.mockResolvedValue(perms(false));
    await service.maySeeClientNumbers(user());

    // A manager flipping the toggle must take effect without a redeploy.
    jest
      .spyOn(Date, 'now')
      .mockReturnValue(Date.now() + 61_000);
    cacheReader.getPermissions.mockResolvedValue(perms(true));

    await expect(service.maySeeClientNumbers(user())).resolves.toBe(true);
    expect(cacheReader.getPermissions).toHaveBeenCalledTimes(2);
    jest.restoreAllMocks();
  });

  it('treats a user with no id as unresolvable', async () => {
    await expect(
      service.maySeeClientNumbers(undefined as never),
    ).resolves.toBe(false);
    expect(cacheReader.getPermissions).not.toHaveBeenCalled();
  });
});

/**
 * "Are this user's jobs scoped to their own?" — the masked call's roster rule
 * for any role, not only the technician one. Read the way every service reads
 * a data scope (`getDataScopeFilter`), and failing CLOSED: a user we cannot
 * vouch for is treated as assigned_only, which only ever narrows who they may
 * ring.
 */
describe('PermissionLookupService.isAssignedOnly', () => {
  let cacheReader: { getPermissions: jest.Mock };
  let fetchImpl: jest.Mock;
  let service: PermissionLookupService;

  beforeEach(() => {
    cacheReader = { getPermissions: jest.fn() };
    fetchImpl = jest.fn();
    service = new PermissionLookupService(cacheReader as never, fetchImpl);
  });

  it('is true for a deals scope of assigned_only', async () => {
    cacheReader.getPermissions.mockResolvedValue(
      perms(false, { dataScope: { deals: 'assigned_only' } }),
    );

    await expect(service.isAssignedOnly(user(), 'deals')).resolves.toBe(true);
  });

  it.each([['all'], ['department']])('is false for a deals scope of %s', async (scope) => {
    cacheReader.getPermissions.mockResolvedValue(perms(false, { dataScope: { deals: scope } }));

    await expect(service.isAssignedOnly(user(), 'deals')).resolves.toBe(false);
  });

  it('is false for a Super Admin', async () => {
    cacheReader.getPermissions.mockResolvedValue(
      perms(false, { roleName: 'Super Admin', isSystemRole: true, dataScope: {} }),
    );

    await expect(service.isAssignedOnly(user(), 'deals')).resolves.toBe(false);
  });

  it('fails closed when the permissions cannot be read', async () => {
    cacheReader.getPermissions.mockRejectedValue(new Error('redis is down'));

    await expect(service.isAssignedOnly(user(), 'deals')).resolves.toBe(true);
  });

  it('fails closed when nobody can answer', async () => {
    cacheReader.getPermissions.mockResolvedValue(null);
    fetchImpl.mockResolvedValue(null);

    await expect(service.isAssignedOnly(user(), 'deals')).resolves.toBe(true);
  });
});
