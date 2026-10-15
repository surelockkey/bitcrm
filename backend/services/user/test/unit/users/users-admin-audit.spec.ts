import { Test } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { CognitoAdminService, PermissionCacheReader } from '@bitcrm/shared';
import { UsersService } from '../../../src/users/users.service';
import { UsersRepository } from '../../../src/users/users.repository';
import { UsersCacheService } from '../../../src/users/users-cache.service';
import { RolesService } from '../../../src/roles/roles.service';
import { RolesCacheService } from '../../../src/roles/roles-cache.service';
import { PermissionResolverService } from '../../../src/roles/permission-resolver.service';
import { AdminAuditService } from '../../../src/audit/admin-audit.service';
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
} from '../mocks';

/**
 * Every sensitive change to a person is recorded with who made it — after it
 * succeeded, never for a refused one. On 2026-10-15 a technician was
 * deactivated and nothing said by whom.
 */
describe('UsersService — admin audit trail', () => {
  let service: UsersService;
  let repository: ReturnType<typeof createMockUsersRepository>;
  let audit: { record: jest.Mock };

  const caller = createMockJwtUser({ id: 'u-admin', roleId: 'role-admin' });
  const target = createMockUser({ id: 'u-bob', firstName: 'bob', lastName: 'tech', email: 'bob@x.y' });
  const roles: Record<string, ReturnType<typeof createMockRole>> = {
    'role-super-admin': createMockRole({ id: 'role-super-admin', name: 'Super Admin', priority: 100, isSystem: true }),
    'role-admin': createMockRole({ id: 'role-admin', name: 'Admin', priority: 80, isSystem: true }),
    'role-dispatcher': createMockRole({ id: 'role-dispatcher', name: 'Dispatcher', priority: 50 }),
    'role-technician': createMockRole({ id: 'role-technician', name: 'Technician', priority: 20 }),
  };

  beforeEach(async () => {
    repository = createMockUsersRepository();
    audit = { record: jest.fn(async () => undefined) };
    const cognito = createMockCognitoAdminService();
    cognito.createUser.mockResolvedValue({ User: { Attributes: [{ Name: 'sub', Value: 'sub-new' }] } });
    const cache = createMockUsersCacheService();
    cache.getUser.mockResolvedValue(null);

    const module = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: UsersRepository, useValue: repository },
        { provide: UsersCacheService, useValue: cache },
        { provide: CognitoAdminService, useValue: cognito },
        { provide: PermissionCacheReader, useValue: createMockPermissionCacheReader() },
        {
          provide: RolesService,
          useValue: {
            findById: jest.fn(async (id: string) => {
              if (roles[id]) return roles[id];
              throw new NotFoundException(id);
            }),
          },
        },
        { provide: RolesCacheService, useValue: createMockRolesCacheService() },
        { provide: PermissionResolverService, useValue: createMockPermissionResolver() },
        { provide: AdminAuditService, useValue: audit },
      ],
    }).compile();
    service = module.get(UsersService);

    repository.findById.mockResolvedValue(target);
    repository.update.mockImplementation(async (_id: string, attrs: object) => ({ ...target, ...attrs }));
    repository.findByRoleId?.mockResolvedValue?.([]);
  });

  const TARGET = { type: 'user', id: 'u-bob', label: 'bob tech <bob@x.y>' };

  it('deactivate: records who switched the person off', async () => {
    await service.deactivate('u-bob', caller);
    expect(audit.record).toHaveBeenCalledWith(caller, 'user.deactivated', TARGET);
  });

  it('a refused deactivation records nothing', async () => {
    await expect(service.deactivate('u-bob', createMockJwtUser({ id: 'u-x', roleId: 'role-technician' }))).rejects.toThrow(
      ForbiddenException,
    );
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('reactivate: recorded', async () => {
    await service.reactivate('u-bob', caller);
    expect(audit.record).toHaveBeenCalledWith(caller, 'user.reactivated', TARGET);
  });

  it('assignRole: records the role it moved from and to', async () => {
    await service.assignRole('u-bob', 'role-dispatcher', caller);
    expect(audit.record).toHaveBeenCalledWith(caller, 'user.role_changed', TARGET, {
      roleId: { from: 'role-technician', to: 'role-dispatcher' },
    });
  });

  it('setPermissionOverrides: records each flipped permission', async () => {
    await service.setPermissionOverrides(
      'u-bob',
      { permissions: { contacts: { view_numbers: true } } } as never,
      caller,
    );
    expect(audit.record).toHaveBeenCalledWith(caller, 'user.permissions_set', TARGET, {
      'permissionOverrides.permissions.contacts.view_numbers': { to: true },
    });
  });

  it('clearPermissionOverrides: records what was cleared', async () => {
    repository.findById.mockResolvedValue({
      ...target,
      permissionOverrides: { permissions: { contacts: { view_numbers: true } } },
    });
    await service.clearPermissionOverrides('u-bob', caller);
    expect(audit.record).toHaveBeenCalledWith(caller, 'user.permissions_cleared', TARGET, {
      'permissionOverrides.permissions.contacts.view_numbers': { from: true },
    });
  });

  it('update: records the fields that moved, and nothing when nothing did', async () => {
    await service.update('u-bob', { firstName: 'Rob', department: target.department } as never, caller);
    expect(audit.record).toHaveBeenCalledWith(caller, 'user.updated', TARGET, {
      firstName: { from: 'bob', to: 'Rob' },
    });

    audit.record.mockClear();
    await service.update('u-bob', { department: target.department } as never, caller);
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('changeUserType: records the move to subcontractor', async () => {
    await service.changeUserType('u-bob', 'subcontractor', caller);
    expect(audit.record).toHaveBeenCalledWith(caller, 'user.type_changed', TARGET, {
      userType: { from: 'regular', to: 'subcontractor' },
    });
  });

  it('create: records the new person with their role', async () => {
    const user = await service.create(
      createMockCreateUserDto({ email: 'new@x.y', firstName: 'N', lastName: 'P', roleId: 'role-technician' }),
      caller,
    );
    expect(audit.record).toHaveBeenCalledWith(
      caller,
      'user.created',
      { type: 'user', id: user.id, label: 'N P <new@x.y>' },
      expect.objectContaining({ roleId: { to: 'role-technician' }, email: { to: 'new@x.y' } }),
    );
  });

  it('resendInvite: recorded when the caller is known', async () => {
    await service.resendInvite('u-bob', caller);
    expect(audit.record).toHaveBeenCalledWith(caller, 'user.invite_resent', TARGET);
  });
});
