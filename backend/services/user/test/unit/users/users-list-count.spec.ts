import { UsersService } from 'src/users/users.service';

/**
 * Скільки користувачів у списку — число, з якого панель робить «Page 2 of 7».
 *
 * Розвилка мусить бути та сама, що в `list`, інакше панель показала б сторінки
 * іншого набору. Роль — окремий випадок: `findByRoleId` і так повертає всю
 * роль, тож її довжина і є відповіддю, а прохід по індексу був би марним.
 */
describe('UsersService.count', () => {
  function makeService() {
    const repository = {
      countAll: jest.fn(),
      countByStatus: jest.fn(),
      countByDepartment: jest.fn(),
      findByRoleId: jest.fn().mockResolvedValue([]),
    };
    const store = new Map<string, string>();
    const redis = {
      client: {
        get: jest.fn(async (k: string) => store.get(k) ?? null),
        set: jest.fn(async (k: string, v: string) => {
          store.set(k, v);
          return 'OK';
        }),
      },
    };
    const service = new UsersService(
      repository as never,
      { getUser: jest.fn(), setUser: jest.fn(), invalidateUser: jest.fn() } as never,
      {} as never,
      {} as never,
      { findById: jest.fn() } as never,
      { invalidateUserPermissions: jest.fn() } as never,
      {} as never,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      redis as never,
    );
    return { service, repository, redis };
  }

  it('counts the whole directory when nothing is filtered', async () => {
    const { service, repository } = makeService();
    repository.countAll.mockResolvedValue({ total: 585, atLeast: false });

    await expect(service.count({} as never)).resolves.toEqual({ total: 585, atLeast: false });
  });

  it('counts on the department index when a department is picked', async () => {
    const { service, repository } = makeService();
    repository.countByDepartment.mockResolvedValue({ total: 4, atLeast: false });

    await expect(service.count({ department: 'HQ' } as never)).resolves.toEqual({
      total: 4,
      atLeast: false,
    });
    expect(repository.countAll).not.toHaveBeenCalled();
  });

  it('counts under the status filter when one is set', async () => {
    const { service, repository } = makeService();
    repository.countByStatus.mockResolvedValue({ total: 12, atLeast: false });

    await expect(service.count({ status: 'active' } as never)).resolves.toEqual({
      total: 12,
      atLeast: false,
    });
  });

  // Роль уже прийшла цілою — рахувати нема чого.
  it('takes a role’s size from the rows it already has, without counting', async () => {
    const { service, repository } = makeService();
    repository.findByRoleId.mockResolvedValue([{ id: 'u-1' }, { id: 'u-2' }]);

    await expect(service.count({ roleId: 'role-tech' } as never)).resolves.toEqual({
      total: 2,
      atLeast: false,
    });
    expect(repository.countAll).not.toHaveBeenCalled();
    expect(repository.countByDepartment).not.toHaveBeenCalled();
  });

  it('carries the floor flag through', async () => {
    const { service, repository } = makeService();
    repository.countAll.mockResolvedValue({ total: 10_000, atLeast: true });

    await expect(service.count({} as never)).resolves.toEqual({ total: 10_000, atLeast: true });
  });

  it('answers a repeat of the same question from the cache', async () => {
    const { service, repository } = makeService();
    repository.countAll.mockResolvedValue({ total: 585, atLeast: false });

    await service.count({} as never);
    await service.count({} as never);

    expect(repository.countAll).toHaveBeenCalledTimes(1);
  });

  it('counts again when the filters change', async () => {
    const { service, repository } = makeService();
    repository.countAll.mockResolvedValue({ total: 585, atLeast: false });
    repository.countByStatus.mockResolvedValue({ total: 12, atLeast: false });

    await service.count({} as never);
    await service.count({ status: 'active' } as never);

    expect(repository.countAll).toHaveBeenCalledTimes(1);
    expect(repository.countByStatus).toHaveBeenCalledTimes(1);
  });
});
