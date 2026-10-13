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

    // The permission cache lives 10 minutes; a role edit that missed user
    // #1001 would leave them on the old matrix for that long.
    it('invalidates EVERY user of the role, not the first page', async () => {
      rolesRepository.findById.mockResolvedValue(createMockRole({ id: 'role-1' }));
      const users = Array.from({ length: 1500 }, (_, i) => ({ id: `u-${i}` }));
      usersRepository.findByRoleId.mockResolvedValue(users);

      await service.update('role-1', { description: 'x' });

      expect(usersRepository.findByRoleId).toHaveBeenCalledWith('role-1');
      expect(rolesCache.invalidateAllUsersWithRole).toHaveBeenCalledWith(
        'role-1',
        users.map((u) => u.id),
      );
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

    it('answers from the shared Redis cache without touching DynamoDB', async () => {
      const role = createMockRole({ id: 'role-1' });
      rolesCache.readRole.mockResolvedValue({ role, gen: '1' });

      await expect(service.findById('role-1')).resolves.toEqual(role);
      expect(rolesRepository.findById).not.toHaveBeenCalled();
    });

    it('fills the Redis cache on a miss, under the generation it read', async () => {
      const role = createMockRole({ id: 'role-1' });
      rolesCache.readRole.mockResolvedValue({ role: null, gen: '7' });
      rolesRepository.findById.mockResolvedValue(role);

      await service.findById('role-1');

      expect(rolesCache.writeRole).toHaveBeenCalledWith(role, '7');
    });

    it('keeps a short in-process copy: a second read asks neither Redis nor DynamoDB', async () => {
      rolesRepository.findById.mockResolvedValue(createMockRole({ id: 'role-1' }));

      await service.findById('role-1');
      await service.findById('role-1');

      expect(rolesCache.readRole).toHaveBeenCalledTimes(1);
      expect(rolesRepository.findById).toHaveBeenCalledTimes(1);
    });

    it('the in-process copy expires after 10 seconds', async () => {
      const now = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
      try {
        rolesRepository.findById.mockResolvedValue(createMockRole({ id: 'role-1' }));
        await service.findById('role-1');
        now.mockReturnValue(1_000_000 + 10_001);
        await service.findById('role-1');
        expect(rolesRepository.findById).toHaveBeenCalledTimes(2);
      } finally {
        now.mockRestore();
      }
    });

    it('falls through to DynamoDB when Redis fails, answers, and writes nothing', async () => {
      const role = createMockRole({ id: 'role-1' });
      rolesCache.readRole.mockRejectedValue(new Error('redis down'));
      rolesRepository.findById.mockResolvedValue(role);

      await expect(service.findById('role-1')).resolves.toEqual(role);
      expect(rolesCache.writeRole).not.toHaveBeenCalled();
    });

    it('a write that fails still answers', async () => {
      const role = createMockRole({ id: 'role-1' });
      rolesCache.writeRole.mockRejectedValue(new Error('redis down'));
      rolesRepository.findById.mockResolvedValue(role);

      await expect(service.findById('role-1')).resolves.toEqual(role);
    });

    it('never caches a missing role', async () => {
      rolesRepository.findById.mockResolvedValue(null);
      await expect(service.findById('role-x')).rejects.toThrow(NotFoundException);
      expect(rolesCache.writeRole).not.toHaveBeenCalled();
    });

    it('an update drops the in-process copy, so the next read sees the new role', async () => {
      rolesRepository.findById.mockResolvedValue(createMockRole({ id: 'role-1', priority: 10 }));
      await service.findById('role-1');

      rolesRepository.findById.mockResolvedValue(createMockRole({ id: 'role-1', priority: 70 }));
      await service.update('role-1', { priority: 70 });

      await expect(service.findById('role-1')).resolves.toMatchObject({ priority: 70 });
      expect(rolesCache.invalidateRole).toHaveBeenCalledWith('role-1');
    });

    it('a load overtaken by an invalidation cannot put the stale role back (Redis or in-process)', async () => {
      // A real RolesCacheService over a Redis fake with GET/SET/MGET/MULTI.
      const data = new Map<string, string>();
      const client = {
        set: jest.fn(async (k: string, v: string) => void data.set(k, v)),
        mget: jest.fn(async (...keys: string[]) => keys.map((k) => data.get(k) ?? null)),
        multi: jest.fn(() => {
          const ops: Array<() => void> = [];
          const tx = {
            incr: (k: string) => (ops.push(() => data.set(k, String(Number(data.get(k) ?? '0') + 1))), tx),
            del: (...ks: string[]) => (ops.push(() => ks.forEach((k) => data.delete(k))), tx),
            exec: async () => ops.forEach((op) => op()),
          };
          return tx;
        }),
      };
      const realCache = new RolesCacheService({ client } as never);
      const svc = new RolesService(rolesRepository as never, realCache, usersRepository as never);

      const stale = createMockRole({ id: 'role-1', priority: 10 });
      const fresh = createMockRole({ id: 'role-1', priority: 70 });
      let finishLoad!: () => void;
      rolesRepository.findById.mockImplementationOnce(
        () => new Promise((resolve) => (finishLoad = () => resolve(stale))),
      );

      // 1. A read starts: Redis misses, DynamoDB is slow and will answer the OLD row.
      const racing = svc.findById('role-1');
      await new Promise((r) => setImmediate(r));

      // 2. The role is updated (and invalidated) meanwhile.
      rolesRepository.findById.mockResolvedValue(fresh);
      await svc.update('role-1', { priority: 70 });

      // 3. The racing load finishes with the stale row and writes it.
      finishLoad();
      await expect(racing).resolves.toMatchObject({ priority: 10 });

      // 4. The next read — here, and on any other task — gets the new role.
      await expect(svc.findById('role-1')).resolves.toMatchObject({ priority: 70 });
      const other = new RolesService(rolesRepository as never, realCache, usersRepository as never);
      await expect(other.findById('role-1')).resolves.toMatchObject({ priority: 70 });
    });

    it('a delete invalidates the cached role', async () => {
      rolesRepository.findById.mockResolvedValue(createMockRole({ id: 'role-1', isSystem: false }));
      await service.delete('role-1');
      expect(rolesCache.invalidateRole).toHaveBeenCalledWith('role-1');
    });

    it('a create invalidates the cached role id', async () => {
      const role = await service.create({
        name: 'New',
        permissions: {},
        dataScope: {},
        dealStageTransitions: [],
        priority: 5,
      });
      expect(rolesCache.invalidateRole).toHaveBeenCalledWith(role.id);
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
    it('should seed all default roles if they do not exist (idempotent)', async () => {
      rolesRepository.findByName.mockResolvedValue(null);

      await service.seedDefaults();

      expect(rolesRepository.create).toHaveBeenCalledTimes(6);

      const createdNames = rolesRepository.create.mock.calls.map(
        (call: unknown[]) => (call[0] as { name: string }).name,
      );
      expect(createdNames).toContain('Super Admin');
      expect(createdNames).toContain('Admin');
      expect(createdNames).toContain('Department Manager');
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

    it('backfills newly-added permission resources into existing roles', async () => {
      // Existing Super Admin seeded BEFORE technicians/skills/commission existed.
      const stale = createMockRole({
        id: 'role-super-admin',
        name: 'Super Admin',
        isSystem: true,
        priority: 100,
        permissions: { deals: { view: true, create: true, edit: true, delete: true } },
        dataScope: { deals: 'all' as never },
      });
      rolesRepository.findByName.mockImplementation((name: string) =>
        name === 'Super Admin' ? Promise.resolve(stale) : Promise.resolve(null),
      );

      await service.seedDefaults();

      const updateCall = rolesRepository.update.mock.calls.find(
        (c: unknown[]) => c[0] === 'role-super-admin',
      );
      expect(updateCall).toBeDefined();
      const attrs = updateCall![1] as { permissions: Record<string, unknown> };
      expect(attrs.permissions.technicians).toBeDefined();
      expect(attrs.permissions.job_types).toBeDefined();
      expect(attrs.permissions.commission).toBeDefined();
      // cache invalidated so resolved permissions recompute for affected users
      expect(rolesCache.invalidateRole).toHaveBeenCalledWith('role-super-admin');
      expect(rolesCache.invalidateAllUsersWithRole).toHaveBeenCalledWith(
        'role-super-admin',
        expect.any(Array),
      );
    });

    it('reconcile invalidates every user of the role (paginated read)', async () => {
      const stale = createMockRole({
        id: 'role-super-admin',
        name: 'Super Admin',
        isSystem: true,
        priority: 100,
        permissions: { deals: { view: true, create: true, edit: true, delete: true } },
        dataScope: { deals: 'all' as never },
      });
      rolesRepository.findByName.mockImplementation((name: string) =>
        name === 'Super Admin' ? Promise.resolve(stale) : Promise.resolve(null),
      );
      const users = Array.from({ length: 1200 }, (_, i) => ({ id: `u-${i}` }));
      usersRepository.findByRoleId.mockResolvedValue(users);

      await service.seedDefaults();

      expect(rolesCache.invalidateAllUsersWithRole).toHaveBeenCalledWith(
        'role-super-admin',
        users.map((u) => u.id),
      );
    });

    it('does not update an existing role that is already complete', async () => {
      const { DEFAULT_ROLES } = await import('../../../src/roles/constants/default-roles');
      const complete = DEFAULT_ROLES.find((r) => r.name === 'Admin')!;
      rolesRepository.findByName.mockImplementation((name: string) =>
        name === 'Admin'
          ? Promise.resolve({ ...complete, createdAt: 'x', updatedAt: 'x' })
          : Promise.resolve(null),
      );

      await service.seedDefaults();

      const updatedAdmin = rolesRepository.update.mock.calls.find(
        (c: unknown[]) => c[0] === 'role-admin',
      );
      expect(updatedAdmin).toBeUndefined();
    });
  });
});
