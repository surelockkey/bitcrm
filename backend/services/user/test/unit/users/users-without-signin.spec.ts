import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { CognitoAdminService, PermissionCacheReader } from '@bitcrm/shared';
import { UserStatus } from '@bitcrm/types';
import { UsersService } from '../../../src/users/users.service';
import { UsersRepository } from '../../../src/users/users.repository';
import { UsersCacheService } from '../../../src/users/users-cache.service';
import { RolesService } from '../../../src/roles/roles.service';
import { RolesCacheService } from '../../../src/roles/roles-cache.service';
import { PermissionResolverService } from '../../../src/roles/permission-resolver.service';
import { TechniciansRepository } from '../../../src/technicians/technicians.repository';
import {
  createMockUser,
  createMockJwtUser,
  createMockRole,
  createMockUsersRepository,
  createMockUsersCacheService,
  createMockCognitoAdminService,
  createMockRolesCacheService,
  createMockPermissionResolver,
  createMockPermissionCacheReader,
  createMockTechniciansRepository,
} from '../mocks';

/**
 * A person imported from Workiz has no sign-in yet: no Cognito account and no
 * `cognitoSub` until "Resend invite" makes one — and the invite writes the
 * role and department claims from the record itself. Every edit that keeps
 * Cognito in step with the record must therefore skip a person without an
 * account; Cognito answers an absent username with "Value at 'username'
 * failed to satisfy constraint: Member must not be null" (dev 2026-10-15,
 * Bohdan TECH's phone saved and the answer still an error).
 */
describe('UsersService — a person with no sign-in yet (imported, never invited)', () => {
  let service: UsersService;
  let repository: ReturnType<typeof createMockUsersRepository>;
  let cognito: ReturnType<typeof createMockCognitoAdminService>;
  let flags: ReturnType<typeof createMockPermissionCacheReader>;

  const admin = createMockJwtUser({ id: 'caller-1', roleId: 'role-admin' });
  const imported = (over = {}) =>
    createMockUser({ id: 'u-1', cognitoSub: undefined as unknown as string, roleId: 'role-technician', department: 'General', ...over });

  beforeEach(async () => {
    repository = createMockUsersRepository();
    cognito = createMockCognitoAdminService();
    flags = createMockPermissionCacheReader();
    const roles = {
      findById: jest.fn().mockImplementation((id: string) => {
        const map: Record<string, unknown> = {
          'role-admin': createMockRole({ id: 'role-admin', name: 'Admin', priority: 80, isSystem: true }),
          'role-dispatcher': createMockRole({ id: 'role-dispatcher', name: 'Dispatcher', priority: 40 }),
          'role-technician': createMockRole({ id: 'role-technician', name: 'Technician', priority: 20 }),
        };
        return map[id] ? Promise.resolve(map[id]) : Promise.reject(new NotFoundException());
      }),
    };
    const module = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: UsersRepository, useValue: repository },
        { provide: UsersCacheService, useValue: createMockUsersCacheService() },
        { provide: CognitoAdminService, useValue: cognito },
        { provide: PermissionCacheReader, useValue: flags },
        { provide: RolesService, useValue: roles },
        { provide: RolesCacheService, useValue: createMockRolesCacheService() },
        { provide: PermissionResolverService, useValue: createMockPermissionResolver() },
        { provide: TechniciansRepository, useValue: createMockTechniciansRepository() },
      ],
    }).compile();
    service = module.get(UsersService);

    repository.update.mockImplementation(async (id: string, attrs: object) => createMockUser({ id, ...attrs }));
    // The phone index: nobody else holds the number.
    (repository as unknown as Record<string, jest.Mock>).findByPhone = jest.fn().mockResolvedValue(null);
    (repository as unknown as Record<string, jest.Mock>).putPhoneIndex = jest.fn().mockResolvedValue(undefined);
    (repository as unknown as Record<string, jest.Mock>).deletePhoneIndex = jest.fn().mockResolvedValue(undefined);
    // Cognito refuses an absent username, as the real one does.
    const refuseNull = (sub: unknown) =>
      sub ? Promise.resolve(undefined) : Promise.reject(new Error("Value at 'username' failed to satisfy constraint: Member must not be null"));
    cognito.updateUserAttributes.mockImplementation(refuseNull);
    cognito.disableUser.mockImplementation(refuseNull);
    cognito.enableUser.mockImplementation(refuseNull);
  });

  it('saves the phone and the department; nothing goes to Cognito', async () => {
    repository.findById.mockResolvedValue(imported());

    await service.update('u-1', { phone: '+380631561365', department: 'Service' } as never, admin);

    expect(repository.update).toHaveBeenCalledWith('u-1', expect.objectContaining({ phone: '+380631561365', department: 'Service' }));
    expect(cognito.updateUserAttributes).not.toHaveBeenCalled();
  });

  it('deactivates and reactivates the record without touching Cognito', async () => {
    repository.findById.mockResolvedValue(imported());
    await service.deactivate('u-1', admin);
    expect(repository.update).toHaveBeenCalledWith('u-1', { status: UserStatus.INACTIVE });

    repository.findById.mockResolvedValue(imported({ status: UserStatus.INACTIVE }));
    await service.reactivate('u-1', admin);
    expect(repository.update).toHaveBeenCalledWith('u-1', { status: UserStatus.ACTIVE });

    expect(cognito.disableUser).not.toHaveBeenCalled();
    expect(cognito.enableUser).not.toHaveBeenCalled();
  });

  it('changes the role on the record without touching Cognito', async () => {
    repository.findById.mockResolvedValue(imported());

    await service.assignRole('u-1', 'role-dispatcher', admin);

    expect(repository.update).toHaveBeenCalledWith('u-1', expect.objectContaining({ roleId: 'role-dispatcher' }));
    expect(cognito.updateUserAttributes).not.toHaveBeenCalled();
  });

  it('becomes a Subcontractor without touching Cognito', async () => {
    repository.findById.mockResolvedValue(imported());

    const updated = await service.changeUserType('u-1', 'subcontractor', admin);

    expect(updated.userType).toBe('subcontractor');
    expect(cognito.disableUser).not.toHaveBeenCalled();
  });

  it('a person WITH a sign-in still has Cognito kept in step', async () => {
    repository.findById.mockResolvedValue(imported({ cognitoSub: 'sub-1' }));

    await service.update('u-1', { department: 'Service' } as never, admin);
    await service.deactivate('u-1', admin);

    expect(cognito.updateUserAttributes).toHaveBeenCalledWith('sub-1', { 'custom:department': 'Service' });
    expect(cognito.disableUser).toHaveBeenCalledWith('sub-1');
  });
});
