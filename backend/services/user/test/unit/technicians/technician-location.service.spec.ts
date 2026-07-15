import { TechnicianLocationService } from '../../../src/technicians/location/technician-location.service';
import { type RedisService } from '@bitcrm/shared';

/**
 * Fake Redis over a Map, supporting the calls the service makes: set (with EX),
 * get, del, and scanning keys by prefix. Good enough to assert real behaviour.
 */
function fakeRedis() {
  const store = new Map<string, string>();
  return {
    store,
    service: {
      client: {
        set: jest.fn(async (k: string, v: string) => {
          store.set(k, v);
          return 'OK';
        }),
        get: jest.fn(async (k: string) => store.get(k) ?? null),
        del: jest.fn(async (k: string) => (store.delete(k) ? 1 : 0)),
        keys: jest.fn(async (pattern: string) => {
          const prefix = pattern.replace(/\*$/, '');
          return [...store.keys()].filter((k) => k.startsWith(prefix));
        }),
        mget: jest.fn(async (...keys: string[]) =>
          keys.map((k) => store.get(k) ?? null),
        ),
      },
    } as unknown as RedisService,
  };
}

describe('TechnicianLocationService', () => {
  let redis: ReturnType<typeof fakeRedis>;
  let service: TechnicianLocationService;

  beforeEach(() => {
    redis = fakeRedis();
    service = new TechnicianLocationService(redis.service);
  });

  it('stores a location with a fresh timestamp and reads it back', async () => {
    await service.setLocation('tech-1', { lat: 33.749, lng: -84.388, accuracy: 12 });

    const loc = await service.getLocation('tech-1');
    expect(loc).toMatchObject({
      userId: 'tech-1',
      lat: 33.749,
      lng: -84.388,
      accuracy: 12,
    });
    expect(loc?.updatedAt).toEqual(expect.any(String));
  });

  // The last known location must persist — the dispatch map always shows where a
  // technician was last seen, and reports how long ago. Freshness (online vs
  // last-seen) is decided from the timestamp, not by the record expiring.
  it('persists the location without an expiry', async () => {
    await service.setLocation('tech-1', { lat: 1, lng: 2 });

    const call = redis.service.client.set as jest.Mock;
    // set(key, value) only — no 'EX'/TTL arguments.
    expect(call.mock.calls[0]).toHaveLength(2);
  });

  it('returns null for a technician with no live location', async () => {
    expect(await service.getLocation('ghost')).toBeNull();
  });

  it('lists every live location for the dispatch map', async () => {
    await service.setLocation('tech-1', { lat: 1, lng: 1 });
    await service.setLocation('tech-2', { lat: 2, lng: 2 });

    const all = await service.listLocations();

    expect(all.map((l) => l.userId).sort()).toEqual(['tech-1', 'tech-2']);
  });

  it('returns an empty list when nobody is online', async () => {
    expect(await service.listLocations()).toEqual([]);
  });

  it('overwrites a technician’s previous fix rather than duplicating', async () => {
    await service.setLocation('tech-1', { lat: 1, lng: 1 });
    await service.setLocation('tech-1', { lat: 9, lng: 9 });

    const all = await service.listLocations();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ lat: 9, lng: 9 });
  });

  it('lets a technician go offline explicitly', async () => {
    await service.setLocation('tech-1', { lat: 1, lng: 1 });
    await service.clearLocation('tech-1');

    expect(await service.getLocation('tech-1')).toBeNull();
    expect(await service.listLocations()).toEqual([]);
  });
});
