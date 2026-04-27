import { Test, TestingModule } from '@nestjs/testing';
import { RedisService } from '@bitcrm/shared';
import { ContactsCacheService } from 'src/contacts/contacts-cache.service';
import { createMockContact, createMockRedisService } from '../mocks';

describe('ContactsCacheService', () => {
  let cache: ContactsCacheService;
  let redis: ReturnType<typeof createMockRedisService>;

  beforeEach(async () => {
    redis = createMockRedisService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContactsCacheService,
        { provide: RedisService, useValue: redis },
      ],
    }).compile();

    cache = module.get<ContactsCacheService>(ContactsCacheService);
  });

  describe('get', () => {
    it('should return parsed contact on cache hit', async () => {
      const contact = createMockContact();
      redis.client.get.mockResolvedValue(JSON.stringify(contact));

      const result = await cache.get('contact-1');

      expect(result).toEqual(contact);
      expect(redis.client.get).toHaveBeenCalledWith('crm:contact:contact-1');
    });

    it('should return null on cache miss', async () => {
      redis.client.get.mockResolvedValue(null);

      const result = await cache.get('contact-1');

      expect(result).toBeNull();
    });
  });

  describe('set', () => {
    it('should store serialized contact with TTL', async () => {
      const contact = createMockContact();
      redis.client.set.mockResolvedValue('OK');

      await cache.set(contact);

      expect(redis.client.set).toHaveBeenCalledWith(
        'crm:contact:contact-1',
        JSON.stringify(contact),
        'EX',
        300,
      );
    });
  });

  describe('invalidate', () => {
    it('should delete cache key', async () => {
      redis.client.del.mockResolvedValue(1);

      await cache.invalidate('contact-1');

      expect(redis.client.del).toHaveBeenCalledWith('crm:contact:contact-1');
    });
  });
});
