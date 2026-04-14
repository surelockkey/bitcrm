import { Test } from '@nestjs/testing';
import { RedisService } from '@bitcrm/shared';
import { DataScope, type ResolvedPermissions } from '@bitcrm/types';
import { RolesCacheService } from '../../src/roles/roles-cache.service';
import { getTestRedisClient } from './setup';
import type Redis from 'ioredis';

describe('RolesCacheService (integration)', () => {
  let service: RolesCacheService;
  let redis: Redis;

  const mockResolvedPermissions: ResolvedPermissions = {
    roleId: 'role-1',
    roleName: 'Admin',
    isSystemRole: false,
    permissions: {
      deals: { view: true, create: true, edit: true, delete: false },
      users: { view: true, create: false, edit: false, delete: false },
    },
    dataScope: {
      deals: DataScope.ALL,
      users: DataScope.DEPARTMENT,
    },
    dealStageTransitions: ['*->*'],
    hasOverrides: false,
  };

  const mockUserPermissions: ResolvedPermissions = {
    ...mockResolvedPermissions,
    hasOverrides: true,
    permissions: {
      ...mockResolvedPermissions.permissions,
      users: { view: true, create: true, edit: false, delete: false },
    },
  };

  beforeAll(async () => {
    redis = getTestRedisClient();

    const module = await Test.createTestingModule({
      providers: [
        RolesCacheService,
        { provide: RedisService, useValue: { client: redis } },
      ],
    }).compile();

    service = module.get(RolesCacheService);
  });

  afterAll(async () => {
    await redis.quit();
  });

  beforeEach(async () => {
    await redis.flushdb();
  });

  describe('role permissions caching', () => {
    it('should store and retrieve role permissions (roundtrip)', async () => {
      await service.setRolePermissions('role-1', mockResolvedPermissions);
      const result = await service.getRolePermissions('role-1');

      expect(result).toEqual(mockResolvedPermissions);
    });

    it('should return null on cache miss', async () => {
      const result = await service.getRolePermissions('nonexistent');
      expect(result).toBeNull();
    });

    it('should invalidate role cache', async () => {
      await service.setRolePermissions('role-1', mockResolvedPermissions);
      await service.invalidateRole('role-1');

      const result = await service.getRolePermissions('role-1');
      expect(result).toBeNull();
    });

    it('should set TTL on cached role permissions', async () => {
      await service.setRolePermissions('role-1', mockResolvedPermissions);

      // Check that a TTL is set (expected ~60s)
      const keys = await redis.keys('*role*');
      expect(keys.length).toBeGreaterThan(0);

      const ttl = await redis.ttl(keys[0]);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(60);
    });
  });

  describe('user permissions caching', () => {
    it('should store and retrieve user permissions (roundtrip)', async () => {
      await service.setUserPermissions('user-1', mockUserPermissions);
      const result = await service.getUserPermissions('user-1');

      expect(result).toEqual(mockUserPermissions);
    });

    it('should return null on user cache miss', async () => {
      const result = await service.getUserPermissions('nonexistent');
      expect(result).toBeNull();
    });

    it('should invalidate user permissions cache', async () => {
      await service.setUserPermissions('user-1', mockUserPermissions);
      await service.invalidateUserPermissions('user-1');

      const result = await service.getUserPermissions('user-1');
      expect(result).toBeNull();
    });
  });

  describe('bulk invalidation', () => {
    it('should invalidate all users with a given role', async () => {
      // Cache permissions for multiple users with the same role
      await service.setUserPermissions('user-1', mockUserPermissions);
      await service.setUserPermissions('user-2', {
        ...mockUserPermissions,
        hasOverrides: false,
      });
      await service.setUserPermissions('user-3', {
        ...mockUserPermissions,
        roleId: 'role-other',
      });

      // Invalidate all users with role-1
      await service.invalidateAllUsersWithRole('role-1', ['user-1', 'user-2']);

      // Users with role-1 should be invalidated
      const result1 = await service.getUserPermissions('user-1');
      const result2 = await service.getUserPermissions('user-2');
      expect(result1).toBeNull();
      expect(result2).toBeNull();

      // User with different role should still be cached
      const result3 = await service.getUserPermissions('user-3');
      expect(result3).not.toBeNull();
    });
  });
});
