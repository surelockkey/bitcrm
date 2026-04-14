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
    it('should store JSON with 60s TTL', async () => {
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
        60,
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
    it('should store with 60s TTL at user:permissions:{userId} key', async () => {
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
        60,
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

  describe('invalidateAllUsersWithRole', () => {
    it('should delete all user permission keys for given user IDs', async () => {
      redisClient.del.mockResolvedValue(1);

      await service.invalidateAllUsersWithRole('role-1', ['user-1', 'user-2', 'user-3']);

      expect(redisClient.del).toHaveBeenCalledWith('user:permissions:user-1');
      expect(redisClient.del).toHaveBeenCalledWith('user:permissions:user-2');
      expect(redisClient.del).toHaveBeenCalledWith('user:permissions:user-3');
    });

    it('should handle empty user array gracefully', async () => {
      await service.invalidateAllUsersWithRole('role-1', []);

      expect(redisClient.del).not.toHaveBeenCalled();
    });
  });
});
