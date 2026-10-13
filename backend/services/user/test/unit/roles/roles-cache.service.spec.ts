import { Test } from '@nestjs/testing';
import { RedisService } from '@bitcrm/shared';
import { DataScope } from '@bitcrm/types';
import { RolesCacheService } from '../../../src/roles/roles-cache.service';
import { createMockRedisClient, createMockRole } from '../mocks';

describe('RolesCacheService', () => {
  let service: RolesCacheService;
  let redisClient: ReturnType<typeof createMockRedisClient>;

  beforeEach(async () => {
    redisClient = createMockRedisClient();

    const module = await Test.createTestingModule({
      providers: [
        RolesCacheService,
        { provide: RedisService, useValue: { client: redisClient } },
      ],
    }).compile();

    service = module.get(RolesCacheService);
  });

  describe('getRolePermissions', () => {
    it('should return parsed JSON from Redis on cache hit', async () => {
      const role = createMockRole();
      const permissions = {
        permissions: role.permissions,
        dataScope: role.dataScope,
        dealStageTransitions: role.dealStageTransitions,
      };
      redisClient.get.mockResolvedValue(JSON.stringify(permissions));

      const result = await service.getRolePermissions('role-1');

      expect(result).toEqual(permissions);
      expect(redisClient.get).toHaveBeenCalledWith('role:permissions:role-1');
    });

    it('should return null on cache miss', async () => {
      redisClient.get.mockResolvedValue(null);

      const result = await service.getRolePermissions('role-1');

      expect(result).toBeNull();
    });
  });

  describe('setRolePermissions', () => {
    it('should store JSON with the permission TTL (600s by default)', async () => {
      const data = {
        permissions: { deals: { view: true, create: false, edit: false, delete: false } },
        dataScope: { deals: DataScope.ALL },
        dealStageTransitions: [],
      };
      redisClient.set.mockResolvedValue('OK');

      await service.setRolePermissions('role-1', data);

      expect(redisClient.set).toHaveBeenCalledWith(
        'role:permissions:role-1',
        JSON.stringify(data),
        'EX',
        600,
      );
    });
  });

  describe('invalidateRole', () => {
    it('should delete the role permissions key', async () => {
      redisClient.del.mockResolvedValue(1);

      await service.invalidateRole('role-1');

      expect(redisClient.del).toHaveBeenCalledWith('role:permissions:role-1');
    });
  });

  describe('getUserPermissions', () => {
    it('should return parsed JSON from user permissions key', async () => {
      const resolved = {
        roleId: 'role-1',
        roleName: 'Test Role',
        isSystemRole: false,
        permissions: { deals: { view: true, create: false, edit: false, delete: false } },
        dataScope: { deals: DataScope.ALL },
        dealStageTransitions: [],
        hasOverrides: false,
      };
      redisClient.get.mockResolvedValue(JSON.stringify(resolved));

      const result = await service.getUserPermissions('user-1');

      expect(result).toEqual(resolved);
      expect(redisClient.get).toHaveBeenCalledWith('user:permissions:user-1');
    });

    it('should return null on cache miss', async () => {
      redisClient.get.mockResolvedValue(null);

      const result = await service.getUserPermissions('user-1');

      expect(result).toBeNull();
    });
  });

  describe('setUserPermissions', () => {
    it('should store with the permission TTL (600s by default) at user:permissions:{userId} key', async () => {
      const resolved = {
        roleId: 'role-1',
        roleName: 'Test Role',
        isSystemRole: false,
        permissions: { deals: { view: true, create: false, edit: false, delete: false } },
        dataScope: { deals: DataScope.ALL },
        dealStageTransitions: [],
        hasOverrides: false,
      };
      redisClient.set.mockResolvedValue('OK');

      await service.setUserPermissions('user-1', resolved);

      expect(redisClient.set).toHaveBeenCalledWith(
        'user:permissions:user-1',
        JSON.stringify(resolved),
        'EX',
        600,
      );
    });
  });

  describe('invalidateUserPermissions', () => {
    it('should delete user permissions key', async () => {
      redisClient.del.mockResolvedValue(1);

      await service.invalidateUserPermissions('user-1');

      expect(redisClient.del).toHaveBeenCalledWith('user:permissions:user-1');
    });
  });

  describe('permission TTL', () => {
    const original = process.env.PERMISSION_CACHE_TTL_SECONDS;
    afterEach(() => {
      if (original === undefined) delete process.env.PERMISSION_CACHE_TTL_SECONDS;
      else process.env.PERMISSION_CACHE_TTL_SECONDS = original;
    });

    const build = () =>
      new RolesCacheService({ client: redisClient } as unknown as RedisService);

    it('reads PERMISSION_CACHE_TTL_SECONDS', async () => {
      process.env.PERMISSION_CACHE_TTL_SECONDS = '120';
      await build().setUserPermissions('user-1', {} as never);
      expect(redisClient.set).toHaveBeenCalledWith('user:permissions:user-1', '{}', 'EX', 120);
    });

    it.each(['', 'abc', '0', '-5'])('falls back to 600s on %p', async (raw) => {
      process.env.PERMISSION_CACHE_TTL_SECONDS = raw;
      await build().setRolePermissions('role-1', {});
      expect(redisClient.set).toHaveBeenCalledWith('role:permissions:role-1', '{}', 'EX', 600);
    });
  });

  describe('invalidateAllUsersWithRole', () => {
    it('should delete all user permission keys for given user IDs', async () => {
      redisClient.del.mockResolvedValue(1);

      await service.invalidateAllUsersWithRole('role-1', ['user-1', 'user-2', 'user-3']);

      expect(redisClient.del).toHaveBeenCalledWith(
        'user:permissions:user-1',
        'user:permissions:user-2',
        'user:permissions:user-3',
      );
    });

    it('deletes a large role in multi-key chunks, every user covered', async () => {
      redisClient.del.mockResolvedValue(1);
      const ids = Array.from({ length: 1200 }, (_, i) => `u-${i}`);

      await service.invalidateAllUsersWithRole('role-1', ids);

      const keys = redisClient.del.mock.calls.flat();
      expect(keys).toHaveLength(1200);
      expect(new Set(keys)).toEqual(new Set(ids.map((id) => `user:permissions:${id}`)));
      expect(redisClient.del.mock.calls.length).toBeLessThan(10);
    });

    it('should handle empty user array gracefully', async () => {
      await service.invalidateAllUsersWithRole('role-1', []);

      expect(redisClient.del).not.toHaveBeenCalled();
    });
  });
});
