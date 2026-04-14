import { Test } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { CognitoAdminService, PermissionCacheReader } from '@bitcrm/shared';
import { UserStatus, DataScope } from '@bitcrm/types';
import type { UserPermissionOverrides } from '@bitcrm/types';
import { UsersService } from '../../../src/users/users.service';
import { UsersRepository } from '../../../src/users/users.repository';
import { UsersCacheService } from '../../../src/users/users-cache.service';
import { RolesService } from '../../../src/roles/roles.service';
import { RolesCacheService } from '../../../src/roles/roles-cache.service';
import { PermissionResolverService } from '../../../src/roles/permission-resolver.service';
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
} from '../mocks';

describe('UsersService — Role Assignment', () => {
  let service: UsersService;
  let repository: ReturnType<typeof createMockUsersRepository> & {
    findByRoleId: jest.Mock;
  };
  let cache: ReturnType<typeof createMockUsersCacheService>;
  let cognito: ReturnType<typeof createMockCognitoAdminService>;
  let rolesService: { findById: jest.Mock };
  let rolesCache: ReturnType<typeof createMockRolesCacheService>;
  let permissionResolver: ReturnType<typeof createMockPermissionResolver>;

  const superAdminRole = createMockRole({
    id: 'role-super-admin',
    name: 'Super Admin',
    priority: 100,
    isSystem: true,
  });

  const adminRole = createMockRole({
    id: 'role-admin',
    name: 'Admin',
    priority: 90,
    isSystem: true,
  });

  const technicianRole = createMockRole({
    id: 'role-technician',
    name: 'Technician',
    priority: 30,
    isSystem: false,
  });

  const dispatcherRole = createMockRole({
    id: 'role-dispatcher',
    name: 'Dispatcher',
    priority: 40,
    isSystem: false,
  });

  beforeEach(async () => {
    const baseRepository = createMockUsersRepository();
    repository = {
      ...baseRepository,
      findByRoleId: jest.fn(),
    } as ReturnType<typeof createMockUsersRepository> & {
      findByRoleId: jest.Mock;
    };
    cache = createMockUsersCacheService();
    cognito = createMockCognitoAdminService();
    rolesService = { findById: jest.fn() };
    rolesCache = createMockRolesCacheService();
    permissionResolver = createMockPermissionResolver();

    const module = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: UsersRepository, useValue: repository },
        { provide: UsersCacheService, useValue: cache },
        { provide: CognitoAdminService, useValue: cognito },
        { provide: PermissionCacheReader, useValue: createMockPermissionCacheReader() },
        { provide: RolesService, useValue: rolesService },
        { provide: RolesCacheService, useValue: rolesCache },
        { provide: PermissionResolverService, useValue: permissionResolver },
      ],
    }).compile();

    service = module.get(UsersService);

    // Default happy-path mocks
    const targetUser = createMockUser({
      id: 'user-1',
      cognitoSub: 'cognito-sub-1',
      roleId: 'role-technician',
      permissionOverrides: {
        permissions: { deals: { view: true, create: true, edit: false, delete: false } },
        dataScope: { deals: DataScope.ASSIGNED_ONLY },
        dealStageTransitions: ['lead->qualified'],
      },
    });
    repository.findById.mockResolvedValue(targetUser);
    repository.update.mockImplementation((_id: string, data: any) =>
      Promise.resolve({ ...targetUser, ...data }),
    );
    repository.findByRoleId.mockResolvedValue([]);
    cache.getUser.mockResolvedValue(null);
    cache.setUser.mockResolvedValue(undefined);
    cache.invalidateUser.mockResolvedValue(undefined);
    cognito.updateUserAttributes.mockResolvedValue(undefined);
    rolesService.findById.mockImplementation((roleId: string) => {
      const map: Record<string, any> = {
        'role-super-admin': superAdminRole,
        'role-admin': adminRole,
        'role-technician': technicianRole,
        'role-dispatcher': dispatcherRole,
      };
      if (map[roleId]) return Promise.resolve(map[roleId]);
      return Promise.reject(new NotFoundException());
    });
    rolesCache.invalidateUserPermissions.mockResolvedValue(undefined);
  });

  describe('assignRole', () => {
    const caller = createMockJwtUser({
      id: 'caller-1',
      roleId: 'role-admin',
    });

    it('should assign role successfully and clear permission overrides', async () => {
      const result = await service.assignRole(
        'user-1',
        'role-dispatcher',
        caller,
      );

      expect(repository.update).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({
          roleId: 'role-dispatcher',
          permissionOverrides: undefined,
        }),
      );
      expect(result.roleId).toBe('role-dispatcher');
      expect(result.permissionOverrides).toBeUndefined();
    });

    it('should update Cognito custom:role_id', async () => {
      await service.assignRole('user-1', 'role-dispatcher', caller);

      expect(cognito.updateUserAttributes).toHaveBeenCalledWith(
        'cognito-sub-1',
        expect.objectContaining({ 'custom:role_id': 'role-dispatcher' }),
      );
    });

    it('should invalidate user cache and permission cache', async () => {
      await service.assignRole('user-1', 'role-dispatcher', caller);

      expect(cache.invalidateUser).toHaveBeenCalledWith('user-1');
      expect(rolesCache.invalidateUserPermissions).toHaveBeenCalledWith(
        'user-1',
      );
    });

    it('should reject when caller priority <= new role priority', async () => {
      // Admin (90) trying to assign Super Admin (100)
      await expect(
        service.assignRole('user-1', 'role-super-admin', caller),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should reject when caller priority equals new role priority', async () => {
      // Admin (90) trying to assign Admin (90)
      await expect(
        service.assignRole('user-1', 'role-admin', caller),
      ).rejects.toThrow(ForbiddenException);
    });

    it("should reject when caller priority <= target's current role priority", async () => {
      // Target user is an admin (90), caller is also admin (90)
      repository.findById.mockResolvedValue(
        createMockUser({
          id: 'user-1',
          cognitoSub: 'cognito-sub-1',
          roleId: 'role-admin',
        }),
      );

      await expect(
        service.assignRole('user-1', 'role-technician', caller),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should reject self-role-change', async () => {
      await expect(
        service.assignRole('caller-1', 'role-dispatcher', caller),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should reject removing last Super Admin', async () => {
      const superAdminUser = createMockUser({
        id: 'user-sa',
        cognitoSub: 'cognito-sub-sa',
        roleId: 'role-super-admin',
        status: UserStatus.ACTIVE,
      });
      repository.findById.mockResolvedValue(superAdminUser);

      // Only this user has the Super Admin role
      repository.findByRoleId.mockResolvedValue([superAdminUser]);

      const superCaller = createMockJwtUser({
        id: 'caller-super',
        roleId: 'role-super-admin',
      });

      // Super Admin trying to demote the only other super admin
      // But first, self-role-change is blocked, so use a different caller
      // Actually, the caller needs higher priority than super admin — only
      // super admins can manage super admins. Let's test that the system
      // blocks removing the LAST super admin even when the caller is valid.
      // Since super admin priority is 100 and we need > 100, let's adjust:
      // The real scenario is a super admin demoting the only OTHER super admin.
      // The caller IS a super admin too, but the check should verify
      // at least one other active super admin remains.
      const otherSuperAdminCaller = createMockJwtUser({
        id: 'caller-sa-other',
        roleId: 'role-super-admin',
      });

      // findByRoleId returns only the target user (the one being demoted)
      repository.findByRoleId.mockResolvedValue([superAdminUser]);

      await expect(
        service.assignRole('user-sa', 'role-admin', otherSuperAdminCaller),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should allow removing Super Admin when another active Super Admin exists', async () => {
      const superAdminUser = createMockUser({
        id: 'user-sa',
        cognitoSub: 'cognito-sub-sa',
        roleId: 'role-super-admin',
        status: UserStatus.ACTIVE,
      });
      const anotherSuperAdmin = createMockUser({
        id: 'caller-sa-other',
        cognitoSub: 'cognito-sub-other-sa',
        roleId: 'role-super-admin',
        status: UserStatus.ACTIVE,
      });
      repository.findById.mockResolvedValue(superAdminUser);
      repository.update.mockResolvedValue({
        ...superAdminUser,
        roleId: 'role-admin',
        permissionOverrides: undefined,
      });

      // Two users with the Super Admin role
      repository.findByRoleId.mockResolvedValue([
        superAdminUser,
        anotherSuperAdmin,
      ]);

      const otherSuperAdminCaller = createMockJwtUser({
        id: 'caller-sa-other',
        roleId: 'role-super-admin',
      });

      await expect(
        service.assignRole('user-sa', 'role-admin', otherSuperAdminCaller),
      ).resolves.toBeDefined();

      expect(repository.update).toHaveBeenCalledWith(
        'user-sa',
        expect.objectContaining({ roleId: 'role-admin' }),
      );
    });

    it('should throw NotFoundException when target user does not exist', async () => {
      repository.findById.mockResolvedValue(null);
      cache.getUser.mockResolvedValue(null);

      await expect(
        service.assignRole('nonexistent', 'role-dispatcher', caller),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when new role does not exist', async () => {
      rolesService.findById.mockImplementation((roleId: string) => {
        if (roleId === 'role-admin') return Promise.resolve(adminRole);
        if (roleId === 'role-technician') return Promise.resolve(technicianRole);
        return Promise.reject(new NotFoundException());
      });

      await expect(
        service.assignRole('user-1', 'role-nonexistent', caller),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
