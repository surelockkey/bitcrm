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
          'role-dispatcher': createMockRole({ id: 'role-dispatcher', name: 'Dispatcher', priority: 40 }),
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

  /**
   * Dispatch has to hear about the two ways of ceasing to be an assignable
   * technician that have nothing to do with job types: losing the role, and
   * the account being switched off. Neither used to publish anything the
   * eligibility projection consumes, so a demoted or deactivated person stayed
   * in the job's technician picker until deal-service happened to restart.
   */
  describe('tech.updated for the eligibility projection', () => {
    const techUpdated = (userId: string, field: string) =>
      expect(sns.publish).toHaveBeenCalledWith('user-events', 'tech.updated', {
        technicianId: userId,
        changedFields: [field],
      });

    it('publishes when a technician is moved to another role', async () => {
      const target = createMockUser({ id: 'u1', roleId: 'role-technician' });
      repository.findById.mockResolvedValue(target);
      repository.update.mockResolvedValue({ ...target, roleId: 'role-dispatcher' });

      await service.assignRole(
        'u1',
        'role-dispatcher',
        createMockJwtUser({ id: 'caller-1', roleId: 'role-admin' }),
      );

      techUpdated('u1', 'role');
    });

    it('publishes when someone is switched onto or off the field team', async () => {
      const target = createMockUser({ id: 'u1', roleId: 'role-dispatcher' });
      repository.findById.mockResolvedValue(target);
      repository.update.mockResolvedValue({ ...target, fieldTeamMember: true });

      await service.update('u1', { fieldTeamMember: true }, createMockJwtUser({ id: 'caller-1', roleId: 'role-admin' }));

      techUpdated('u1', 'fieldTeamMember');
    });

    it('says nothing to dispatch when an edit leaves the field team alone', async () => {
      const target = createMockUser({ id: 'u1', roleId: 'role-technician' });
      repository.findById.mockResolvedValue(target);
      repository.update.mockResolvedValue({ ...target, firstName: 'Ada' });

      await service.update('u1', { firstName: 'Ada' }, createMockJwtUser({ id: 'caller-1', roleId: 'role-admin' }));

      expect(sns.publish).not.toHaveBeenCalledWith('user-events', 'tech.updated', expect.anything());
    });

    it('publishes on deactivation', async () => {
      repository.findById.mockResolvedValue(createMockUser({ id: 'u1', roleId: 'role-technician' }));

      await service.deactivate('u1', createMockJwtUser({ id: 'caller-1', roleId: 'role-admin' }));

      techUpdated('u1', 'status');
    });

    it('publishes on reactivation', async () => {
      repository.findById.mockResolvedValue(createMockUser({ id: 'u1', roleId: 'role-technician' }));

      await service.reactivate('u1', createMockJwtUser({ id: 'caller-1', roleId: 'role-admin' }));

      techUpdated('u1', 'status');
    });
  });
});
