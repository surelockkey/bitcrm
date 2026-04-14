import { Test } from '@nestjs/testing';
import {
  ConflictException,
  ForbiddenException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { RolesService } from '../../../src/roles/roles.service';
import { RolesRepository } from '../../../src/roles/roles.repository';
import { RolesCacheService } from '../../../src/roles/roles-cache.service';
import { UsersRepository } from '../../../src/users/users.repository';
import {
  createMockRole,
  createMockRolesRepository,
  createMockRolesCacheService,
  createMockUsersRepository,
} from '../mocks';

describe('RolesService', () => {
  let service: RolesService;
  let rolesRepository: ReturnType<typeof createMockRolesRepository>;
  let rolesCache: ReturnType<typeof createMockRolesCacheService>;
  let usersRepository: ReturnType<typeof createMockUsersRepository>;

  beforeEach(async () => {
    rolesRepository = createMockRolesRepository();
    rolesCache = createMockRolesCacheService();
    usersRepository = createMockUsersRepository();

    const module = await Test.createTestingModule({
      providers: [
        RolesService,
        { provide: RolesRepository, useValue: rolesRepository },
        { provide: RolesCacheService, useValue: rolesCache },
        { provide: UsersRepository, useValue: usersRepository },
      ],
    }).compile();

    service = module.get(RolesService);

    // Default happy-path mocks
    rolesRepository.findById.mockResolvedValue(createMockRole());
    rolesRepository.findByName.mockResolvedValue(null);
    rolesRepository.create.mockResolvedValue(undefined);
    rolesRepository.update.mockResolvedValue(createMockRole());
    rolesRepository.delete.mockResolvedValue(undefined);
    rolesRepository.findAll.mockResolvedValue([]);
    rolesCache.invalidateRole.mockResolvedValue(undefined);
    rolesCache.invalidateAllUsersWithRole.mockResolvedValue(undefined);
    usersRepository.findByRole.mockResolvedValue({ items: [], nextCursor: undefined });
  });

  describe('create', () => {
    it('should create role successfully with valid permission matrix', async () => {
      const dto = {
        name: 'Custom Role',
        description: 'A custom role',
        permissions: {
          deals: { view: true, create: true, edit: false, delete: false },
          contacts: { view: true, create: false, edit: false, delete: false },
        },
        dataScope: { deals: 'all', contacts: 'department' },
        dealStageTransitions: ['lead->qualified'],
        priority: 40,
      };

      const result = await service.create(dto);

      expect(rolesRepository.create).toHaveBeenCalledTimes(1);
      const createdRole = rolesRepository.create.mock.calls[0][0];
      expect(createdRole.name).toBe('Custom Role');
      expect(createdRole.permissions).toEqual(dto.permissions);
      expect(createdRole.isSystem).toBe(false);
      expect(createdRole.id).toBeDefined();
    });

    it('should reject duplicate role name', async () => {
      rolesRepository.findByName.mockResolvedValue(createMockRole({ name: 'Existing Role' }));

      const dto = {
        name: 'Existing Role',
        permissions: {
          deals: { view: true, create: false, edit: false, delete: false },
        },
        dataScope: {},
        dealStageTransitions: [],
        priority: 40,
      };

      await expect(service.create(dto)).rejects.toThrow(ConflictException);
      expect(rolesRepository.create).not.toHaveBeenCalled();
    });

    it('should validate permissions against RESOURCE_REGISTRY and reject unknown resource', async () => {
      const dto = {
        name: 'Bad Role',
        permissions: {
          unknownResource: { view: true, create: false, edit: false, delete: false },
        },
        dataScope: {},
        dealStageTransitions: [],
        priority: 40,
      };

      await expect(service.create(dto)).rejects.toThrow(BadRequestException);
      expect(rolesRepository.create).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('should update role and invalidate both role cache and all users cache', async () => {
      const existingRole = createMockRole({ id: 'role-1' });
      rolesRepository.findById.mockResolvedValue(existingRole);
      rolesRepository.update.mockResolvedValue(
        createMockRole({ id: 'role-1', description: 'Updated description' }),
      );

      await service.update('role-1', { description: 'Updated description' });

      expect(rolesRepository.update).toHaveBeenCalledTimes(1);
      expect(rolesCache.invalidateRole).toHaveBeenCalledWith('role-1');
      expect(rolesCache.invalidateAllUsersWithRole).toHaveBeenCalledWith('role-1', []);
    });

    it('should reject ALL edits to the system Super Admin role', async () => {
      const superAdminRole = createMockRole({
        id: 'role-super-admin',
        name: 'Super Admin',
        isSystem: true,
        priority: 100,
      });
      rolesRepository.findById.mockResolvedValue(superAdminRole);

      await expect(
        service.update('role-super-admin', { description: 'Harmless change' }),
      ).rejects.toThrow(ForbiddenException);

      expect(rolesRepository.update).not.toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('should delete custom role successfully', async () => {
      const customRole = createMockRole({ id: 'role-custom', isSystem: false });
      rolesRepository.findById.mockResolvedValue(customRole);
      usersRepository.findByRole.mockResolvedValue({ items: [], nextCursor: undefined });

      await service.delete('role-custom');

      expect(rolesRepository.delete).toHaveBeenCalledWith('role-custom');
    });

    it('should reject deleting system role', async () => {
      const systemRole = createMockRole({
        id: 'role-admin',
        name: 'Admin',
        isSystem: true,
      });
      rolesRepository.findById.mockResolvedValue(systemRole);

      await expect(service.delete('role-admin')).rejects.toThrow(ForbiddenException);
      expect(rolesRepository.delete).not.toHaveBeenCalled();
    });

    it('should reject deleting role that has assigned users', async () => {
      const customRole = createMockRole({ id: 'role-custom', isSystem: false });
      rolesRepository.findById.mockResolvedValue(customRole);
      usersRepository.findByRole.mockResolvedValue({
        items: [{ id: 'user-1' }],
        nextCursor: undefined,
      });

      await expect(service.delete('role-custom')).rejects.toThrow(ConflictException);
      expect(rolesRepository.delete).not.toHaveBeenCalled();
    });
  });

  describe('findById', () => {
    it('should return role from repository', async () => {
      const role = createMockRole({ id: 'role-1' });
      rolesRepository.findById.mockResolvedValue(role);

      const result = await service.findById('role-1');

      expect(result).toEqual(role);
      expect(rolesRepository.findById).toHaveBeenCalledWith('role-1');
    });

    it('should throw NotFoundException when role not found', async () => {
      rolesRepository.findById.mockResolvedValue(null);

      await expect(service.findById('role-missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('findAll', () => {
    it('should return all roles from repository', async () => {
      const roles = [createMockRole(), createMockRole({ id: 'role-2', name: 'Role 2' })];
      rolesRepository.findAll.mockResolvedValue(roles);

      const result = await service.findAll();

      expect(result).toEqual(roles);
      expect(rolesRepository.findAll).toHaveBeenCalled();
    });
  });

  describe('seedDefaults', () => {
    it('should seed 5 default roles if they do not exist (idempotent)', async () => {
      rolesRepository.findByName.mockResolvedValue(null);

      await service.seedDefaults();

      expect(rolesRepository.create).toHaveBeenCalledTimes(5);

      // Verify all 5 default role names were seeded
      const createdNames = rolesRepository.create.mock.calls.map(
        (call: unknown[]) => (call[0] as { name: string }).name,
      );
      expect(createdNames).toContain('Super Admin');
      expect(createdNames).toContain('Admin');
      expect(createdNames).toContain('Dispatcher');
      expect(createdNames).toContain('Technician');
      expect(createdNames).toContain('Read Only');
    });

    it('should skip seeding roles that already exist', async () => {
      // All 5 roles already exist
      rolesRepository.findByName.mockResolvedValue(createMockRole());

      await service.seedDefaults();

      expect(rolesRepository.create).not.toHaveBeenCalled();
    });
  });
});
