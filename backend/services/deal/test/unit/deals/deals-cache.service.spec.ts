import { DealsCacheService } from 'src/deals/deals-cache.service';
import { createMockRedisService, createMockDeal } from '../mocks';

describe('DealsCacheService', () => {
  let cache: DealsCacheService;
  let redis: ReturnType<typeof createMockRedisService>;

  beforeEach(() => {
    redis = createMockRedisService();
    cache = new DealsCacheService(redis as any);
  });

  describe('get', () => {
    it('should return parsed deal on cache hit', async () => {
      const deal = createMockDeal();
      redis.client.get.mockResolvedValue(JSON.stringify(deal));

      const result = await cache.get('deal-1');

      expect(result).toEqual(deal);
      expect(redis.client.get).toHaveBeenCalledWith('deal:deal-1');
    });

    it('should return null on cache miss', async () => {
      redis.client.get.mockResolvedValue(null);

      const result = await cache.get('deal-1');

      expect(result).toBeNull();
    });
  });

  describe('set', () => {
    it('should store stringified deal with TTL', async () => {
      const deal = createMockDeal();
      redis.client.set.mockResolvedValue('OK');

      await cache.set(deal);

      expect(redis.client.set).toHaveBeenCalledWith(
        'deal:deal-1',
        JSON.stringify(deal),
        'EX',
        300,
      );
    });
  });

  describe('invalidate', () => {
    it('should delete cache key', async () => {
      redis.client.del.mockResolvedValue(1);

      await cache.invalidate('deal-1');

      expect(redis.client.del).toHaveBeenCalledWith('deal:deal-1');
    });
  });
});
