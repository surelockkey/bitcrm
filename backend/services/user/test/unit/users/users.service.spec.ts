import { Test } from '@nestjs/testing';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { CognitoAdminService, PermissionCacheReader } from '@bitcrm/shared';
import { UserStatus } from '@bitcrm/types';
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
  createMockUpdateUserDto,
  createMockRole,
  createMockUsersRepository,
  createMockUsersCacheService,
  createMockCognitoAdminService,
  createMockRolesCacheService,
  createMockPermissionResolver,
  createMockPermissionCacheReader,
} from '../mocks';

jest.mock('crypto', () => ({
  ...jest.requireActual('crypto'),
  randomUUID: () => 'generated-uuid',
}));

describe('UsersService', () => {
  let service: UsersService;
  let repository: ReturnType<typeof createMockUsersRepository>;
  let cache: ReturnType<typeof createMockUsersCacheService>;
  let cognito: ReturnType<typeof createMockCognitoAdminService>;
  let rolesService: { findById: jest.Mock };

  const adminRole = createMockRole({ id: 'role-admin', name: 'Admin', priority: 80, isSystem: true });
  const technicianRole = createMockRole({ id: 'role-technician', name: 'Technician', priority: 20, isSystem: false });
  const superAdminRole = createMockRole({ id: 'role-super-admin', name: 'Super Admin', priority: 100, isSystem: true });

  beforeEach(async () => {
    repository = createMockUsersRepository();
    cache = createMockUsersCacheService();
    cognito = createMockCognitoAdminService();
    rolesService = {
      findById: jest.fn().mockImplementation((roleId: string) => {
        const map: Record<string, any> = {
          'role-admin': adminRole,
          'role-technician': technicianRole,
          'role-super-admin': superAdminRole,
        };
        if (map[roleId]) return Promise.resolve(map[roleId]);
        return Promise.reject(new NotFoundException(`Role ${roleId} not found`));
      }),
    };

    const module = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: UsersRepository, useValue: repository },
        { provide: UsersCacheService, useValue: cache },
        { provide: CognitoAdminService, useValue: cognito },
        { provide: PermissionCacheReader, useValue: createMockPermissionCacheReader() },
        { provide: RolesService, useValue: rolesService },
        { provide: RolesCacheService, useValue: createMockRolesCacheService() },
        { provide: PermissionResolverService, useValue: createMockPermissionResolver() },
      ],
    }).compile();

    service = module.get(UsersService);

    // Default happy-path mocks
    repository.findById.mockResolvedValue(createMockUser());
    repository.create.mockResolvedValue(undefined);
    repository.update.mockResolvedValue(createMockUser());
    cache.getUser.mockResolvedValue(null);
    cache.setUser.mockResolvedValue(undefined);
    cache.invalidateUser.mockResolvedValue(undefined);
    cognito.createUser.mockResolvedValue({
      User: {
        Attributes: [{ Name: 'sub', Value: 'cognito-sub-new' }],
      },
    });
    cognito.deleteUser.mockResolvedValue(undefined);
    cognito.updateUserAttributes.mockResolvedValue(undefined);
    cognito.disableUser.mockResolvedValue(undefined);
    cognito.enableUser.mockResolvedValue(undefined);
  });

  describe('create', () => {
    const dto = createMockCreateUserDto(); // roleId: 'role-technician'
    const caller = createMockJwtUser({ roleId: 'role-admin' }); // priority 80

    it('should create user successfully (happy path)', async () => {
      const result = await service.create(dto, caller);

      expect(rolesService.findById).toHaveBeenCalledWith('role-technician');
      expect(rolesService.findById).toHaveBeenCalledWith('role-admin');
      expect(cognito.createUser).toHaveBeenCalledWith(dto.email, {
        'custom:role_id': 'role-technician',
        'custom:department': dto.department,
        'custom:user_id': 'generated-uuid',
      });
      expect(repository.create).toHaveBeenCalledTimes(1);
      expect(cache.setUser).toHaveBeenCalledTimes(1);
      expect(result.id).toBe('generated-uuid');
      expect(result.email).toBe(dto.email);
      expect(result.roleId).toBe('role-technician');
      expect(result.status).toBe(UserStatus.ACTIVE);
    });

    it('should throw ForbiddenException when caller tries to assign role with equal or higher priority', async () => {
      const adminDto = createMockCreateUserDto({ roleId: 'role-admin' } as any);

      await expect(service.create(adminDto, caller)).rejects.toThrow(
        ForbiddenException,
      );
      expect(cognito.createUser).not.toHaveBeenCalled();
    });

    it('should throw ForbiddenException when low-priority caller tries to create any higher-role user', async () => {
      const techCaller = createMockJwtUser({ roleId: 'role-technician' }); // priority 20

      await expect(service.create(dto, techCaller)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should throw NotFoundException when roleId does not exist', async () => {
      const badDto = createMockCreateUserDto({ roleId: 'role-nonexistent' } as any);

      await expect(service.create(badDto, caller)).rejects.toThrow(
        NotFoundException,
      );
      expect(cognito.createUser).not.toHaveBeenCalled();
    });

    it('should throw ConflictException on UsernameExistsException', async () => {
      const error = new Error('User already exists');
      error.name = 'UsernameExistsException';
      cognito.createUser.mockRejectedValue(error);

      await expect(service.create(dto, caller)).rejects.toThrow(
        ConflictException,
      );
    });

    it('should re-throw non-UsernameExistsException Cognito errors', async () => {
      const error = new Error('Service unavailable');
      error.name = 'ServiceException';
      cognito.createUser.mockRejectedValue(error);

      await expect(service.create(dto, caller)).rejects.toThrow(
        'Service unavailable',
      );
    });

    it('should rollback Cognito user if DynamoDB create fails', async () => {
      repository.create.mockRejectedValue(new Error('DynamoDB error'));

      await expect(service.create(dto, caller)).rejects.toThrow(
        'DynamoDB error',
      );
      expect(cognito.deleteUser).toHaveBeenCalledWith(dto.email);
    });

    it('should propagate original error even if rollback fails', async () => {
      repository.create.mockRejectedValue(new Error('DynamoDB error'));
      cognito.deleteUser.mockRejectedValue(new Error('Delete failed'));

      await expect(service.create(dto, caller)).rejects.toThrow(
        'DynamoDB error',
      );
    });

    it('should set status to ACTIVE and timestamps', async () => {
      const result = await service.create(dto, caller);

      expect(result.status).toBe(UserStatus.ACTIVE);
      expect(result.createdAt).toBeDefined();
      expect(result.updatedAt).toBeDefined();
      expect(result.createdAt).toBe(result.updatedAt);
    });
  });

  describe('findById', () => {
    it('should return cached user on hit (repo NOT called)', async () => {
      const user = createMockUser();
      cache.getUser.mockResolvedValue(user);

      const result = await service.findById('user-1');

      expect(result).toEqual(user);
      expect(repository.findById).not.toHaveBeenCalled();
    });

    it('should fall back to repo on cache miss and set cache', async () => {
      const user = createMockUser();
      cache.getUser.mockResolvedValue(null);
      repository.findById.mockResolvedValue(user);

      const result = await service.findById('user-1');

      expect(result).toEqual(user);
      expect(cache.setUser).toHaveBeenCalledWith(user);
    });

    it('should throw NotFoundException when not found', async () => {
      cache.getUser.mockResolvedValue(null);
      repository.findById.mockResolvedValue(null);

      await expect(service.findById('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findCurrentUser', () => {
    it('should delegate to findById with caller.id', async () => {
      const user = createMockUser({ id: 'caller-1' });
      cache.getUser.mockResolvedValue(user);
      const caller = createMockJwtUser({ id: 'caller-1' });

      const result = await service.findCurrentUser(caller);

      expect(result.id).toBe('caller-1');
    });
  });

  describe('list', () => {
    const paginatedResult = {
      items: [createMockUser()],
      nextCursor: 'cursor-abc',
    };

    it('should route to findByRoleId when roleId filter present', async () => {
      (repository as any).findByRoleId = jest.fn().mockResolvedValue([createMockUser()]);

      await service.list({ roleId: 'role-technician' } as never);

      expect((repository as any).findByRoleId).toHaveBeenCalledWith('role-technician');
    });

    it('should route to findByDepartment when department filter present', async () => {
      repository.findByDepartment.mockResolvedValue(paginatedResult);

      await service.list({ department: 'HVAC' } as never);

      expect(repository.findByDepartment).toHaveBeenCalled();
    });

    it('should route to findByStatus when status filter present', async () => {
      repository.findByStatus.mockResolvedValue(paginatedResult);

      await service.list({ status: UserStatus.ACTIVE } as never);

      expect(repository.findByStatus).toHaveBeenCalled();
    });

    it('should route to findAll when no filters', async () => {
      repository.findAll.mockResolvedValue(paginatedResult);

      await service.list({} as never);

      expect(repository.findAll).toHaveBeenCalled();
    });

    it('should default limit to 20', async () => {
      repository.findAll.mockResolvedValue(paginatedResult);

      await service.list({} as never);

      expect(repository.findAll).toHaveBeenCalledWith(20, undefined);
    });
  });

  describe('update', () => {
    const caller = createMockJwtUser({ id: 'caller-1', roleId: 'role-admin' });

    it('should update name fields successfully', async () => {
      const updated = createMockUser({ firstName: 'Updated' });
      repository.update.mockResolvedValue(updated);
      const dto = createMockUpdateUserDto({ firstName: 'Updated' });

      const result = await service.update('user-1', dto, caller);

      expect(result.firstName).toBe('Updated');
      expect(cognito.updateUserAttributes).not.toHaveBeenCalled();
      expect(cache.invalidateUser).toHaveBeenCalledWith('user-1');
    });

    it('should sync department to Cognito when department is changed', async () => {
      const updated = createMockUser({ department: 'Plumbing' });
      repository.update.mockResolvedValue(updated);
      const dto = createMockUpdateUserDto({ department: 'Plumbing' });

      await service.update('user-1', dto, caller);

      expect(cognito.updateUserAttributes).toHaveBeenCalledWith(
        'cognito-sub-1',
        { 'custom:department': 'Plumbing' },
      );
    });

    it('should NOT call Cognito when only name fields change', async () => {
      repository.update.mockResolvedValue(createMockUser());
      const dto = createMockUpdateUserDto({ firstName: 'Updated' });

      await service.update('user-1', dto, caller);

      expect(cognito.updateUserAttributes).not.toHaveBeenCalled();
    });
  });

  describe('deactivate', () => {
    const caller = createMockJwtUser({ id: 'caller-1', roleId: 'role-admin' });

    it('should deactivate successfully', async () => {
      await service.deactivate('user-1', caller);

      expect(repository.update).toHaveBeenCalledWith('user-1', {
        status: UserStatus.INACTIVE,
      });
      expect(cognito.disableUser).toHaveBeenCalledWith('cognito-sub-1');
      expect(cache.invalidateUser).toHaveBeenCalledWith('user-1');
    });

    it('should throw ForbiddenException on self-deactivation', async () => {
      await expect(
        service.deactivate('caller-1', caller),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw ForbiddenException when caller cannot manage target (equal or higher priority)', async () => {
      repository.findById.mockResolvedValue(
        createMockUser({ roleId: 'role-super-admin' }),
      );
      cache.getUser.mockResolvedValue(null);

      await expect(service.deactivate('user-1', caller)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('reactivate', () => {
    const caller = createMockJwtUser({ id: 'caller-1', roleId: 'role-admin' });

    it('should reactivate successfully', async () => {
      await service.reactivate('user-1', caller);

      expect(repository.update).toHaveBeenCalledWith('user-1', {
        status: UserStatus.ACTIVE,
      });
      expect(cognito.enableUser).toHaveBeenCalledWith('cognito-sub-1');
      expect(cache.invalidateUser).toHaveBeenCalledWith('user-1');
    });

    it('should throw ForbiddenException when caller cannot manage target', async () => {
      repository.findById.mockResolvedValue(
        createMockUser({ roleId: 'role-super-admin' }),
      );
      cache.getUser.mockResolvedValue(null);

      await expect(service.reactivate('user-1', caller)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });
});
