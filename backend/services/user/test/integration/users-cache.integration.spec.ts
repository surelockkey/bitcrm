import { Test } from '@nestjs/testing';
import { RedisService } from '@bitcrm/shared';
import { UserStatus, type User } from '@bitcrm/types';
import { UsersCacheService } from '../../src/users/users-cache.service';
import { getTestRedisClient } from './setup';
import type Redis from 'ioredis';

describe('UsersCacheService (integration)', () => {
  let service: UsersCacheService;
  let redis: Redis;

  const mockUser: User = {
    id: 'user-1',
    cognitoSub: 'cognito-sub-1',
    email: 'test@example.com',
    firstName: 'John',
    lastName: 'Doe',
    roleId: 'role-technician',
    department: 'HVAC',
    status: UserStatus.ACTIVE,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  beforeAll(async () => {
    redis = getTestRedisClient();

    const module = await Test.createTestingModule({
      providers: [
        UsersCacheService,
        { provide: RedisService, useValue: { client: redis } },
      ],
    }).compile();

    service = module.get(UsersCacheService);
  });

  afterAll(async () => {
    await redis.quit();
  });

  beforeEach(async () => {
    await redis.flushdb();
  });

  it('should store and retrieve a user (roundtrip)', async () => {
    await service.setUser(mockUser);
    const result = await service.getUser('user-1');

    expect(result).toEqual(mockUser);
  });

  it('should return null for nonexistent key', async () => {
    const result = await service.getUser('nonexistent');
    expect(result).toBeNull();
  });

  it('should invalidate (remove) cached user', async () => {
    await service.setUser(mockUser);
    await service.invalidateUser('user-1');

    const result = await service.getUser('user-1');
    expect(result).toBeNull();
  });

  it('should set TTL on cached user', async () => {
    await service.setUser(mockUser);

    const ttl = await redis.ttl('user:user-1');
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(300);
  });

  it('should overwrite existing cached user', async () => {
    await service.setUser(mockUser);
    const updated = { ...mockUser, firstName: 'Jane' };
    await service.setUser(updated);

    const result = await service.getUser('user-1');
    expect(result!.firstName).toBe('Jane');
  });
});
