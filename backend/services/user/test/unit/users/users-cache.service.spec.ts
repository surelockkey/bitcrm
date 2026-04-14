import { Test } from '@nestjs/testing';
import { RedisService } from '@bitcrm/shared';
import { UsersCacheService } from '../../../src/users/users-cache.service';
import { createMockRedisClient, createMockUser } from '../mocks';

describe('UsersCacheService', () => {
  let service: UsersCacheService;
  let redisClient: ReturnType<typeof createMockRedisClient>;

  beforeEach(async () => {
    redisClient = createMockRedisClient();

    const module = await Test.createTestingModule({
      providers: [
        UsersCacheService,
        { provide: RedisService, useValue: { client: redisClient } },
      ],
    }).compile();

    service = module.get(UsersCacheService);
  });

  describe('getUser', () => {
    it('should return parsed user on cache hit', async () => {
      const user = createMockUser();
      redisClient.get.mockResolvedValue(JSON.stringify(user));

      const result = await service.getUser('user-1');

      expect(result).toEqual(user);
      expect(redisClient.get).toHaveBeenCalledWith('user:user-1');
    });

    it('should return null on cache miss', async () => {
      redisClient.get.mockResolvedValue(null);

      const result = await service.getUser('user-1');

      expect(result).toBeNull();
    });
  });

  describe('setUser', () => {
    it('should serialize user and set with correct key and TTL', async () => {
      const user = createMockUser();
      redisClient.set.mockResolvedValue('OK');

      await service.setUser(user);

      expect(redisClient.set).toHaveBeenCalledWith(
        'user:user-1',
        JSON.stringify(user),
        'EX',
        300,
      );
    });
  });

  describe('invalidateUser', () => {
    it('should delete the correct key', async () => {
      redisClient.del.mockResolvedValue(1);

      await service.invalidateUser('user-1');

      expect(redisClient.del).toHaveBeenCalledWith('user:user-1');
    });
  });
});
