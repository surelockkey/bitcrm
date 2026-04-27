import { Test, TestingModule } from '@nestjs/testing';
import { RedisService } from '@bitcrm/shared';
import { CompaniesCacheService } from 'src/companies/companies-cache.service';
import { createMockCompany, createMockRedisService } from '../mocks';

describe('CompaniesCacheService', () => {
  let cache: CompaniesCacheService;
  let redis: ReturnType<typeof createMockRedisService>;

  beforeEach(async () => {
    redis = createMockRedisService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CompaniesCacheService,
        { provide: RedisService, useValue: redis },
      ],
    }).compile();

    cache = module.get<CompaniesCacheService>(CompaniesCacheService);
  });

  describe('get', () => {
    it('should return parsed company on cache hit', async () => {
      const company = createMockCompany();
      redis.client.get.mockResolvedValue(JSON.stringify(company));

      const result = await cache.get('company-1');

      expect(result).toEqual(company);
      expect(redis.client.get).toHaveBeenCalledWith('crm:company:company-1');
    });

    it('should return null on cache miss', async () => {
      redis.client.get.mockResolvedValue(null);

      const result = await cache.get('company-1');

      expect(result).toBeNull();
    });
  });

  describe('set', () => {
    it('should store serialized company with TTL', async () => {
      const company = createMockCompany();
      redis.client.set.mockResolvedValue('OK');

      await cache.set(company);

      expect(redis.client.set).toHaveBeenCalledWith(
        'crm:company:company-1',
        JSON.stringify(company),
        'EX',
        300,
      );
    });
  });

  describe('invalidate', () => {
    it('should delete cache key', async () => {
      redis.client.del.mockResolvedValue(1);

      await cache.invalidate('company-1');

      expect(redis.client.del).toHaveBeenCalledWith('crm:company:company-1');
    });
  });
});
