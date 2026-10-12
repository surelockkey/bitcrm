import { ConflictException } from '@nestjs/common';
import { UsersService } from 'src/users/users.service';

/**
 * Inviting a user is two writes that must stand or fall together: the Cognito
 * sign-in account and the user row. On 2026-10-12 an invite failed between
 * them (the phone was on another profile), the account stayed behind, and
 * every retry for that email answered "already exists" — the user was in
 * Cognito and nowhere else.
 */

const CALLER = { id: 'admin-1', roleId: 'role-admin' } as never;
const ROLES: Record<string, { id: string; name: string; priority: number; isSystem: boolean }> = {
  'role-admin': { id: 'role-admin', name: 'Admin', priority: 90, isSystem: true },
  'role-dispatcher': { id: 'role-dispatcher', name: 'Dispatcher', priority: 50, isSystem: true },
};

const DTO = {
  email: 'harry@example.com',
  firstName: 'Harry',
  lastName: 'Hill',
  roleId: 'role-dispatcher',
  department: 'office',
};

const cognitoCreated = (sub: string) => ({
  User: { Attributes: [{ Name: 'sub', Value: sub }] },
});

function usernameExists() {
  const e = new Error('User account already exists');
  e.name = 'UsernameExistsException';
  return e;
}

function makeService(over: {
  repository?: Partial<Record<string, jest.Mock>>;
  cognito?: Partial<Record<string, jest.Mock>>;
} = {}) {
  const repository = {
    findById: jest.fn().mockResolvedValue(null),
    findByPhone: jest.fn().mockResolvedValue(null),
    putPhoneIndex: jest.fn().mockResolvedValue(undefined),
    deletePhoneIndex: jest.fn().mockResolvedValue(undefined),
    create: jest.fn(async (user: unknown) => user),
    ...over.repository,
  };
  const cognitoAdmin = {
    createUser: jest.fn().mockResolvedValue(cognitoCreated('sub-new')),
    deleteUser: jest.fn().mockResolvedValue(undefined),
    getUser: jest.fn().mockResolvedValue(null),
    disableUser: jest.fn().mockResolvedValue(undefined),
    ...over.cognito,
  };
  const cache = {
    getUser: jest.fn().mockResolvedValue(null),
    setUser: jest.fn(),
    invalidateUser: jest.fn(),
  };
  const rolesService = {
    findById: jest.fn(async (id: string) => {
      const role = ROLES[id];
      if (!role) throw new Error(`no role ${id}`);
      return role;
    }),
  };
  const service = new UsersService(
    repository as never,
    cache as never,
    cognitoAdmin as never,
    {} as never,
    rolesService as never,
    {} as never,
    {} as never,
  );
  return { service, repository, cognitoAdmin };
}

describe('UsersService.create — the sign-in account and the row stand or fall together', () => {
  it('refuses a phone that is on another profile before any sign-in account is made', async () => {
    const { service, repository, cognitoAdmin } = makeService({
      repository: {
        findByPhone: jest.fn().mockResolvedValue({
          id: 'u-will',
          firstName: 'Will',
          lastName: 'Manager',
        }),
      },
    });

    await expect(
      service.create({ ...DTO, phone: '(203) 747-9615' } as never, CALLER),
    ).rejects.toThrow(/\+12037479615 is already on Will Manager's profile/);

    expect(cognitoAdmin.createUser).not.toHaveBeenCalled();
    expect(repository.putPhoneIndex).not.toHaveBeenCalled();
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('removes the sign-in account again when the row cannot be written', async () => {
    const { service, repository, cognitoAdmin } = makeService({
      repository: { create: jest.fn().mockRejectedValue(new Error('Dynamo down')) },
    });

    await expect(
      service.create({ ...DTO, phone: '(203) 747-9615' } as never, CALLER),
    ).rejects.toThrow('Dynamo down');

    expect(cognitoAdmin.deleteUser).toHaveBeenCalledWith(DTO.email);
    // The phone was claimed for a user that never came to be — give it back.
    expect(repository.deletePhoneIndex).toHaveBeenCalledWith('+12037479615');
  });

  it('removes the sign-in account again when claiming the phone fails', async () => {
    const { service, cognitoAdmin } = makeService({
      repository: { putPhoneIndex: jest.fn().mockRejectedValue(new Error('Dynamo down')) },
    });

    await expect(
      service.create({ ...DTO, phone: '(203) 747-9615' } as never, CALLER),
    ).rejects.toThrow('Dynamo down');

    expect(cognitoAdmin.deleteUser).toHaveBeenCalledWith(DTO.email);
  });

  it('replaces a sign-in account that an earlier failed invite left behind', async () => {
    const createUser = jest
      .fn()
      .mockRejectedValueOnce(usernameExists())
      .mockResolvedValueOnce(cognitoCreated('sub-fresh'));
    const { service, repository, cognitoAdmin } = makeService({
      cognito: {
        createUser,
        // The account points at a user id that was never written.
        getUser: jest.fn().mockResolvedValue({
          status: 'FORCE_CHANGE_PASSWORD',
          enabled: true,
          sub: 'sub-ghost',
          userId: 'ghost-id',
        }),
      },
    });

    const user = await service.create(DTO as never, CALLER);

    expect(cognitoAdmin.getUser).toHaveBeenCalledWith(DTO.email);
    expect(repository.findById).toHaveBeenCalledWith('ghost-id');
    expect(cognitoAdmin.deleteUser).toHaveBeenCalledWith(DTO.email);
    expect(createUser).toHaveBeenCalledTimes(2);
    expect(user).toMatchObject({ email: DTO.email, cognitoSub: 'sub-fresh', status: 'active' });
    expect(repository.create).toHaveBeenCalledTimes(1);
  });

  it('still refuses an email that belongs to an existing user', async () => {
    const { service, repository, cognitoAdmin } = makeService({
      repository: { findById: jest.fn().mockResolvedValue({ id: 'u-existing', email: DTO.email }) },
      cognito: {
        createUser: jest.fn().mockRejectedValue(usernameExists()),
        getUser: jest.fn().mockResolvedValue({
          status: 'CONFIRMED',
          enabled: true,
          sub: 'sub-existing',
          userId: 'u-existing',
        }),
      },
    });

    await expect(service.create(DTO as never, CALLER)).rejects.toThrow(ConflictException);
    await expect(service.create(DTO as never, CALLER)).rejects.toThrow(
      'A user with this email already exists',
    );
    expect(cognitoAdmin.deleteUser).not.toHaveBeenCalled();
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('leaves a sign-in account alone when it names no user of ours', async () => {
    const { service, cognitoAdmin } = makeService({
      cognito: {
        createUser: jest.fn().mockRejectedValue(usernameExists()),
        // Made outside the app (the seed admin, a console user): not ours to remove.
        getUser: jest.fn().mockResolvedValue({ status: 'CONFIRMED', enabled: true, sub: 'sub-x' }),
      },
    });

    await expect(service.create(DTO as never, CALLER)).rejects.toThrow(
      'A user with this email already exists',
    );
    expect(cognitoAdmin.deleteUser).not.toHaveBeenCalled();
  });

  it('answers the plain conflict when the account cannot even be looked at', async () => {
    const { service, cognitoAdmin } = makeService({
      cognito: {
        createUser: jest.fn().mockRejectedValue(usernameExists()),
        getUser: jest.fn().mockRejectedValue(new Error('Cognito down')),
      },
    });

    await expect(service.create(DTO as never, CALLER)).rejects.toThrow(
      'A user with this email already exists',
    );
    expect(cognitoAdmin.deleteUser).not.toHaveBeenCalled();
  });
});
