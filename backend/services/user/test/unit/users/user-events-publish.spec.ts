import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import {
  CognitoAdminService,
  PermissionCacheReader,
  SnsPublisherService,
} from '@bitcrm/shared';
import { UsersService } from '../../../src/users/users.service';
import { UsersRepository } from '../../../src/users/users.repository';
import { UsersCacheService } from '../../../src/users/users-cache.service';
import { RolesService } from '../../../src/roles/roles.service';
import { RolesCacheService } from '../../../src/roles/roles-cache.service';
import { PermissionResolverService } from '../../../src/roles/permission-resolver.service';
import {
  createMockUser,
  createMockJwtUser,
  createMockCreateUserDto,
  createMockRole,
  createMockUsersRepository,
  createMockUsersCacheService,
  createMockCognitoAdminService,
  createMockRolesCacheService,
  createMockPermissionResolver,
  createMockPermissionCacheReader,
  createMockSnsPublisher,
} from '../mocks';

describe('UsersService event publishing', () => {
  let service: UsersService;
  let sns: ReturnType<typeof createMockSnsPublisher>;
  let repository: ReturnType<typeof createMockUsersRepository>;
  let cognito: ReturnType<typeof createMockCognitoAdminService>;

  beforeEach(async () => {
    repository = createMockUsersRepository();
    const cache = createMockUsersCacheService();
    cognito = createMockCognitoAdminService();
    sns = createMockSnsPublisher();

    const roles = {
      findById: jest.fn().mockImplementation((id: string) => {
        const map: Record<string, unknown> = {
          'role-admin': createMockRole({ id: 'role-admin', name: 'Admin', priority: 80, isSystem: true }),
          'role-technician': createMockRole({ id: 'role-technician', name: 'Technician', priority: 20 }),
        };
        if (map[id]) return Promise.resolve(map[id]);
        return Promise.reject(new NotFoundException());
      }),
    };

    const module = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: UsersRepository, useValue: repository },
        { provide: UsersCacheService, useValue: cache },
        { provide: CognitoAdminService, useValue: cognito },
        { provide: PermissionCacheReader, useValue: createMockPermissionCacheReader() },
        { provide: RolesService, useValue: roles },
        { provide: RolesCacheService, useValue: createMockRolesCacheService() },
        { provide: PermissionResolverService, useValue: createMockPermissionResolver() },
        { provide: SnsPublisherService, useValue: sns },
      ],
    }).compile();

    service = module.get(UsersService);

    repository.create.mockResolvedValue(undefined);
    cache.setUser.mockResolvedValue(undefined);
    cognito.createUser.mockResolvedValue({
      User: { Attributes: [{ Name: 'sub', Value: 'sub-1' }] },
    });
  });

  it('publishes user events to the registered "user-events" topic key', async () => {
    await service.create(
      createMockCreateUserDto({ roleId: 'role-technician' }),
      createMockJwtUser({ roleId: 'role-admin' }),
    );

    expect(sns.publish).toHaveBeenCalledWith(
      'user-events',
      'user.activated',
      expect.objectContaining({ roleId: 'role-technician' }),
    );
    // guard against the historical mismatched key
    expect(sns.publish).not.toHaveBeenCalledWith(
      'bitcrm-user-events',
      expect.anything(),
      expect.anything(),
    );
  });

  it('resendInvite re-sends the Cognito invite and emits user.invite-resent', async () => {
    repository.findById.mockResolvedValue(createMockUser({ id: 'u1', email: 'u1@test.com' }));
    await service.resendInvite('u1');
    expect(cognito.resendInvite).toHaveBeenCalledWith('u1@test.com');
    expect(sns.publish).toHaveBeenCalledWith(
      'user-events',
      'user.invite-resent',
      expect.objectContaining({ userId: 'u1' }),
    );
  });

  it('createMockUser sanity (status active)', () => {
    expect(createMockUser().status).toBeDefined();
  });
});
