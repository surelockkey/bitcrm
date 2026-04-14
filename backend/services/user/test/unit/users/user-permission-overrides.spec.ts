import { Test } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { CognitoAdminService, PermissionCacheReader } from '@bitcrm/shared';
import { DataScope } from '@bitcrm/types';
import type {
  UserPermissionOverrides,
  ResolvedPermissions,
} from '@bitcrm/types';
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

describe('UsersService — Permission Overrides', () => {
  let service: UsersService;
  let repository: ReturnType<typeof createMockUsersRepository>;
  let cache: ReturnType<typeof createMockUsersCacheService>;
  let cognito: ReturnType<typeof createMockCognitoAdminService>;
  let rolesService: { findById: jest.Mock };
  let rolesCache: ReturnType<typeof createMockRolesCacheService>;
  let permissionResolver: ReturnType<typeof createMockPermissionResolver>;

  const callerRole = createMockRole({
    id: 'role-admin',
    name: 'Admin',
    priority: 90,
    isSystem: true,
  });

  const targetRole = createMockRole({
    id: 'role-technician',
    name: 'Technician',
    priority: 30,
    isSystem: false,
  });

  const overrides: UserPermissionOverrides = {
    permissions: {
      deals: { view: true, create: true, edit: true, delete: false },
    },
    dataScope: { deals: DataScope.DEPARTMENT },
    dealStageTransitions: ['lead->qualified'],
  };

  beforeEach(async () => {
    repository = createMockUsersRepository();
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
      roleId: 'role-technician',
    });
    repository.findById.mockResolvedValue(targetUser);
    repository.update.mockResolvedValue({
      ...targetUser,
      permissionOverrides: overrides,
    });
    cache.getUser.mockResolvedValue(null);
    cache.setUser.mockResolvedValue(undefined);
    cache.invalidateUser.mockResolvedValue(undefined);
    rolesService.findById.mockImplementation((roleId: string) => {
      if (roleId === 'role-admin') return Promise.resolve(callerRole);
      if (roleId === 'role-technician') return Promise.resolve(targetRole);
      return Promise.reject(new NotFoundException());
    });
    rolesCache.invalidateUserPermissions.mockResolvedValue(undefined);
    rolesCache.setUserPermissions.mockResolvedValue(undefined);
    rolesCache.getUserPermissions.mockResolvedValue(null);
  });

  describe('setPermissionOverrides', () => {
    const caller = createMockJwtUser({
      id: 'caller-1',
      roleId: 'role-admin',
    });

    it('should update user with overrides in DynamoDB and invalidate user permission cache', async () => {
      const result = await service.setPermissionOverrides(
        'user-1',
        overrides,
        caller,
      );

      expect(repository.update).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ permissionOverrides: overrides }),
      );
      expect(cache.invalidateUser).toHaveBeenCalledWith('user-1');
      expect(rolesCache.invalidateUserPermissions).toHaveBeenCalledWith(
        'user-1',
      );
      expect(result.permissionOverrides).toEqual(overrides);
    });

    it('should allow caller with higher role priority', async () => {
      await expect(
        service.setPermissionOverrides('user-1', overrides, caller),
      ).resolves.toBeDefined();
    });

    it('should reject caller with lower or equal role priority', async () => {
      const lowPriorityCaller = createMockJwtUser({
        id: 'caller-low',
        roleId: 'role-technician',
      });

      await expect(
        service.setPermissionOverrides('user-1', overrides, lowPriorityCaller),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should reject caller with equal role priority', async () => {
      const equalRole = createMockRole({
        id: 'role-equal',
        name: 'Equal',
        priority: 30,
      });
      rolesService.findById.mockImplementation((roleId: string) => {
        if (roleId === 'role-equal') return Promise.resolve(equalRole);
        if (roleId === 'role-technician') return Promise.resolve(targetRole);
        return Promise.reject(new NotFoundException());
      });

      const equalCaller = createMockJwtUser({
        id: 'caller-eq',
        roleId: 'role-equal',
      });

      await expect(
        service.setPermissionOverrides('user-1', overrides, equalCaller),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw NotFoundException when target user does not exist', async () => {
      repository.findById.mockResolvedValue(null);
      cache.getUser.mockResolvedValue(null);

      await expect(
        service.setPermissionOverrides('nonexistent', overrides, caller),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('clearPermissionOverrides', () => {
    const caller = createMockJwtUser({
      id: 'caller-1',
      roleId: 'role-admin',
    });

    it('should set permissionOverrides to undefined and invalidate cache', async () => {
      const clearedUser = createMockUser({
        id: 'user-1',
        permissionOverrides: undefined,
      });
      repository.update.mockResolvedValue(clearedUser);

      const result = await service.clearPermissionOverrides('user-1', caller);

      expect(repository.update).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ permissionOverrides: undefined }),
      );
      expect(cache.invalidateUser).toHaveBeenCalledWith('user-1');
      expect(rolesCache.invalidateUserPermissions).toHaveBeenCalledWith(
        'user-1',
      );
      expect(result.permissionOverrides).toBeUndefined();
    });

    it('should require caller with higher priority than target', async () => {
      const lowPriorityCaller = createMockJwtUser({
        id: 'caller-low',
        roleId: 'role-technician',
      });

      await expect(
        service.clearPermissionOverrides('user-1', lowPriorityCaller),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('getResolvedPermissions', () => {
    const resolvedPermissions: ResolvedPermissions = {
      roleId: 'role-technician',
      roleName: 'Technician',
      isSystemRole: false,
      permissions: {
        deals: { view: true, create: true, edit: true, delete: false },
        contacts: { view: true, create: false, edit: false, delete: false },
      },
      dataScope: { deals: DataScope.DEPARTMENT, contacts: DataScope.DEPARTMENT },
      dealStageTransitions: ['lead->qualified', '*->canceled'],
      hasOverrides: true,
    };

    it('should fetch user, fetch role, call resolver, and return merged result', async () => {
      const userWithOverrides = createMockUser({
        id: 'user-1',
        roleId: 'role-technician',
        permissionOverrides: overrides,
      });
      repository.findById.mockResolvedValue(userWithOverrides);
      cache.getUser.mockResolvedValue(null);
      rolesCache.getUserPermissions.mockResolvedValue(null);
      permissionResolver.resolve.mockReturnValue(resolvedPermissions);

      const result = await service.getResolvedPermissions('user-1');

      expect(repository.findById).toHaveBeenCalled();
      expect(rolesService.findById).toHaveBeenCalledWith('role-technician');
      expect(permissionResolver.resolve).toHaveBeenCalledWith(
        targetRole,
        overrides,
      );
      expect(result).toEqual(resolvedPermissions);
    });

    it('should cache the result via RolesCacheService.setUserPermissions', async () => {
      const userWithOverrides = createMockUser({
        id: 'user-1',
        roleId: 'role-technician',
        permissionOverrides: overrides,
      });
      repository.findById.mockResolvedValue(userWithOverrides);
      cache.getUser.mockResolvedValue(null);
      rolesCache.getUserPermissions.mockResolvedValue(null);
      permissionResolver.resolve.mockReturnValue(resolvedPermissions);

      await service.getResolvedPermissions('user-1');

      expect(rolesCache.setUserPermissions).toHaveBeenCalledWith(
        'user-1',
        resolvedPermissions,
      );
    });

    it('should return cached permissions when available', async () => {
      rolesCache.getUserPermissions.mockResolvedValue(resolvedPermissions);

      const result = await service.getResolvedPermissions('user-1');

      expect(result).toEqual(resolvedPermissions);
      expect(permissionResolver.resolve).not.toHaveBeenCalled();
    });

    it('should return permissions without overrides when user has none', async () => {
      const userNoOverrides = createMockUser({
        id: 'user-1',
        roleId: 'role-technician',
        permissionOverrides: undefined,
      });
      const baseResolved: ResolvedPermissions = {
        ...resolvedPermissions,
        hasOverrides: false,
      };
      repository.findById.mockResolvedValue(userNoOverrides);
      cache.getUser.mockResolvedValue(null);
      rolesCache.getUserPermissions.mockResolvedValue(null);
      permissionResolver.resolve.mockReturnValue(baseResolved);

      const result = await service.getResolvedPermissions('user-1');

      expect(permissionResolver.resolve).toHaveBeenCalledWith(
        targetRole,
        undefined,
      );
      expect(result.hasOverrides).toBe(false);
    });

    it('should throw NotFoundException when user does not exist', async () => {
      repository.findById.mockResolvedValue(null);
      cache.getUser.mockResolvedValue(null);
      rolesCache.getUserPermissions.mockResolvedValue(null);

      await expect(
        service.getResolvedPermissions('nonexistent'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
