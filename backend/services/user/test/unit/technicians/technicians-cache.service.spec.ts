import { type TechnicianProfile } from '@bitcrm/types';
import { TechniciansCacheService } from '../../../src/technicians/technicians-cache.service';
import { createMockRedisClient } from '../mocks';

const profile: TechnicianProfile = {
  userId: 'tech-1',
  callMaskingEnabled: false,
  gpsTrackingEnabled: false,
  mobileAppInstalled: false,
  status: 'pending',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('TechniciansCacheService (unit)', () => {
  let redis: ReturnType<typeof createMockRedisClient>;
  let cache: TechniciansCacheService;

  beforeEach(() => {
    redis = createMockRedisClient();
    cache = new TechniciansCacheService({ client: redis } as never);
  });

  it('returns null on cache miss', async () => {
    redis.get.mockResolvedValue(null);
    expect(await cache.getProfile('tech-1')).toBeNull();
    expect(redis.get).toHaveBeenCalledWith('technician:tech-1');
  });

  it('parses the cached profile on hit', async () => {
    redis.get.mockResolvedValue(JSON.stringify(profile));
    expect(await cache.getProfile('tech-1')).toMatchObject({ userId: 'tech-1' });
  });

  it('sets with a TTL', async () => {
    redis.set.mockResolvedValue('OK');
    await cache.setProfile(profile);
    expect(redis.set).toHaveBeenCalledWith(
      'technician:tech-1',
      JSON.stringify(profile),
      'EX',
      expect.any(Number),
    );
  });

  it('invalidates by userId', async () => {
    redis.del.mockResolvedValue(1);
    await cache.invalidateProfile('tech-1');
    expect(redis.del).toHaveBeenCalledWith('technician:tech-1');
  });
});
