import { UsersService } from 'src/users/users.service';

/**
 * Resolving teammate NAMES without opening the user directory.
 *
 * A technician holds `users.view: false`, so `GET /users` 403s for them — and
 * every screen that joins ids to names through it falls back to rendering a
 * raw uuid. They still legitimately need to see who else is on their job.
 *
 * `namesByIds` is the narrow answer: you must already hold the id, you get back
 * a name and nothing else, and there is no way to enumerate.
 */
describe('UsersService.namesByIds', () => {
  function makeService(
    users: Record<string, Record<string, unknown>> = {
      'u-1': { id: 'u-1', firstName: 'Nazarii', lastName: 'Tech', email: 'n@x.com', phone: '+14045550111', roleId: 'role-technician', department: 'Field', status: 'active' },
      'u-2': { id: 'u-2', firstName: 'bob', lastName: 'tech', email: 'b@x.com', phone: '+14045550112', roleId: 'role-technician', department: 'tech', status: 'active' },
    },
  ) {
    const repository = {
      findById: jest.fn(async (id: string) => users[id] ?? null),
    };
    const service = new UsersService(
      repository as never,
      { getUser: jest.fn(), setUser: jest.fn(), invalidateUser: jest.fn() } as never,
      {} as never,
      {} as never,
      { findById: jest.fn() } as never,
      { invalidateUserPermissions: jest.fn() } as never,
      {} as never,
    );
    return { service, repository };
  }

  it('returns a name for each id it was given', async () => {
    const { service } = makeService();

    await expect(service.namesByIds(['u-1', 'u-2'])).resolves.toEqual([
      { id: 'u-1', firstName: 'Nazarii', lastName: 'Tech' },
      { id: 'u-2', firstName: 'bob', lastName: 'tech' },
    ]);
  });

  /**
   * The whole point: this is a name lookup, not a thin `GET /users`. Anything
   * else on the record — and a teammate's personal phone in particular — must
   * not ride along.
   */
  it('returns the name and nothing else', async () => {
    const { service } = makeService();

    const [user] = await service.namesByIds(['u-1']);

    expect(Object.keys(user).sort()).toEqual(['firstName', 'id', 'lastName']);
    expect(JSON.stringify(user)).not.toContain('@');
    expect(JSON.stringify(user)).not.toContain('+1404');
    expect(JSON.stringify(user)).not.toContain('role-');
  });

  it('silently omits ids that do not exist', async () => {
    const { service } = makeService();

    await expect(service.namesByIds(['u-1', 'nope'])).resolves.toEqual([
      { id: 'u-1', firstName: 'Nazarii', lastName: 'Tech' },
    ]);
  });

  it('returns nothing for an empty list without touching the table', async () => {
    const { service, repository } = makeService();

    await expect(service.namesByIds([])).resolves.toEqual([]);
    expect(repository.findById).not.toHaveBeenCalled();
  });

  it('de-duplicates repeated ids', async () => {
    const { service, repository } = makeService();

    const out = await service.namesByIds(['u-1', 'u-1', 'u-1']);

    expect(out).toHaveLength(1);
    expect(repository.findById).toHaveBeenCalledTimes(1);
  });

  /**
   * A cap is what keeps "you must already hold the id" true — without one,
   * a caller could sweep a generated id space in a single request.
   */
  it('caps how many ids one call may resolve', async () => {
    const { service, repository } = makeService();
    const many = Array.from({ length: 500 }, (_, i) => `u-${i}`);

    await service.namesByIds(many);

    expect(repository.findById.mock.calls.length).toBeLessThanOrEqual(200);
  });

  it('tolerates blank and non-string ids', async () => {
    const { service } = makeService();

    await expect(
      service.namesByIds(['u-1', '', undefined as never, null as never]),
    ).resolves.toEqual([{ id: 'u-1', firstName: 'Nazarii', lastName: 'Tech' }]);
  });

  it('survives a lookup that throws, without failing the whole batch', async () => {
    const { service, repository } = makeService();
    repository.findById.mockImplementation(async (id: string) => {
      if (id === 'u-2') throw new Error('dynamo blip');
      return { id, firstName: 'Nazarii', lastName: 'Tech' };
    });

    await expect(service.namesByIds(['u-1', 'u-2'])).resolves.toEqual([
      { id: 'u-1', firstName: 'Nazarii', lastName: 'Tech' },
    ]);
  });
});
