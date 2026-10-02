import { BadRequestException } from '@nestjs/common';
import { UserStatus, type User } from '@bitcrm/types';
import { UsersService } from 'src/users/users.service';

/**
 * Пошук на сторінці Users шукає по всьому довіднику, а не по рядках поточної
 * сторінки: користувач із другої сторінки знаходиться так само, як із першої,
 * а «Page 1 of N» і лічильник рахують лише збіги.
 */
describe('UsersService — search across the whole directory', () => {
  const user = (id: string, over: Partial<User>): User =>
    ({
      id,
      firstName: 'X',
      lastName: 'Y',
      email: `${id}@example.com`,
      roleId: 'role-tech',
      department: 'Field',
      status: UserStatus.ACTIVE,
      ...over,
    }) as User;

  const directory = [
    user('u1', { firstName: 'Anna', lastName: 'Smith', department: 'Office', roleId: 'role-csr' }),
    user('u2', { firstName: 'Bob', lastName: 'Jones', phone: '+1 (404) 555-0123' }),
    user('u3', { firstName: 'Carl', lastName: 'Smithers', status: UserStatus.INACTIVE }),
    user('u4', { firstName: 'Dana', lastName: 'Smith', email: 'dana.s@surelock.com' }),
    user('u5', { firstName: 'Eve', lastName: 'Brown' }),
  ];

  function makeService() {
    // Two pages, as the directory scan hands them back: the match on page two is the bug.
    const repository = {
      findAll: jest.fn(async (_limit: number, cursor?: string) =>
        cursor === 'p2' ? { items: directory.slice(3) } : { items: directory.slice(0, 3), nextCursor: 'p2' },
      ),
      findByRoleId: jest.fn(),
      findByStatus: jest.fn(),
      findByDepartment: jest.fn(),
      countAll: jest.fn(),
      countByStatus: jest.fn(),
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

  const ids = (r: { data: User[] }) => r.data.map((u) => u.id);

  it('finds a user who sits on the second page of the directory', async () => {
    const { service } = makeService();
    const res = await service.list({ search: 'brown', limit: 20 } as never);
    expect(ids(res)).toEqual(['u5']);
    expect(res.pagination.nextCursor).toBeUndefined();
  });

  it('matches every word anywhere in name, email, department or phone, ignoring case', async () => {
    const { service } = makeService();
    expect(ids(await service.list({ search: 'SMITH' } as never))).toEqual(['u1', 'u3', 'u4']);
    expect(ids(await service.list({ search: 'dana smith' } as never))).toEqual(['u4']);
    expect(ids(await service.list({ search: 'surelock' } as never))).toEqual(['u4']);
    expect(ids(await service.list({ search: 'office' } as never))).toEqual(['u1']);
    expect(ids(await service.list({ search: '5550123' } as never))).toEqual(['u2']);
    expect(ids(await service.list({ search: '555-0123' } as never))).toEqual(['u2']);
  });

  it('pages the matches in name order, with a cursor to the next page', async () => {
    const { service } = makeService();
    const first = await service.list({ search: 'smith', limit: 2 } as never);
    expect(ids(first)).toEqual(['u1', 'u3']);
    expect(first.pagination.nextCursor).toEqual(expect.any(String));
    const second = await service.list({ search: 'smith', limit: 2, cursor: first.pagination.nextCursor } as never);
    expect(ids(second)).toEqual(['u4']);
    expect(second.pagination.nextCursor).toBeUndefined();
  });

  it('keeps the role and status filters while searching', async () => {
    const { service } = makeService();
    expect(ids(await service.list({ search: 'smith', status: UserStatus.ACTIVE } as never))).toEqual(['u1', 'u4']);
    expect(ids(await service.list({ search: 'smith', roleId: 'role-csr' } as never))).toEqual(['u1']);
  });

  it('counts only the matches, so the pager says Page 1 of 1', async () => {
    const { service, repository } = makeService();
    await expect(service.count({ search: 'smith', status: UserStatus.ACTIVE } as never)).resolves.toEqual({ total: 2, atLeast: false });
    expect(repository.countAll).not.toHaveBeenCalled();
  });

  it('a blank search is no search: the plain directory page', async () => {
    const { service, repository } = makeService();
    const res = await service.list({ search: '   ', limit: 3 } as never);
    expect(ids(res)).toEqual(['u1', 'u2', 'u3']);
    expect(repository.findAll).toHaveBeenCalledWith(3, undefined);
  });

  it('400s a cursor the search did not issue', async () => {
    const { service } = makeService();
    await expect(service.list({ search: 'smith', cursor: 'p2' } as never)).rejects.toBeInstanceOf(BadRequestException);
  });
});
