import { TechnicianLocationService } from '../../../src/technicians/location/technician-location.service';
import { type RedisService } from '@bitcrm/shared';
import { type TechniciansService } from '../../../src/technicians/technicians.service';

/**
 * Fake Redis over a Map, supporting the calls the service makes: set (with EX),
 * get, del, mget, and SCAN with a cursor — pages of `COUNT` keys, so a test can
 * prove the service walks every page. `keys` is there only to prove it is
 * never called: KEYS blocks Redis for the whole keyspace. `pageSize` is what
 * the fake hands back per SCAN round trip, whatever COUNT the caller hints.
 */
function fakeRedis(pageSize = 100) {
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
        keys: jest.fn(async () => {
          throw new Error('KEYS must not be used');
        }),
        scan: jest.fn(async (cursor: string, _match: 'MATCH', pattern: string) => {
          const prefix = pattern.replace(/\*$/, '');
          const all = [...store.keys()].filter((k) => k.startsWith(prefix));
          const start = Number(cursor);
          const page = all.slice(start, start + pageSize);
          const next = start + pageSize >= all.length ? '0' : String(start + pageSize);
          return [next, page] as [string, string[]];
        }),
        mget: jest.fn(async (...keys: string[]) => keys.map((k) => store.get(k) ?? null)),
      },
    } as unknown as RedisService,
  };
}

/** The policy, as the technicians service answers it: tracked unless a test says otherwise. */
function fakePolicy(off: string[] = []) {
  return {
    isLocationTracked: jest.fn(async (userId: string) => !off.includes(userId)),
  };
}

describe('TechnicianLocationService', () => {
  let redis: ReturnType<typeof fakeRedis>;
  let policy: ReturnType<typeof fakePolicy>;
  let service: TechnicianLocationService;

  const build = (off: string[] = []) => {
    policy = fakePolicy(off);
    return new TechnicianLocationService(
      redis.service,
      policy as unknown as Pick<TechniciansService, 'isLocationTracked'> as TechniciansService,
    );
  };

  beforeEach(() => {
    redis = fakeRedis();
    service = build();
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

  // The map dims a pin after 90 s and prints "Last seen" from the timestamp;
  // the expiry only has to make sure yesterday's position is gone by the next
  // morning without anyone deleting anything.
  it('keeps a fix for 12 hours after the last report', async () => {
    await service.setLocation('tech-1', { lat: 1, lng: 2 });

    const call = redis.service.client.set as jest.Mock;
    expect(call.mock.calls[0].slice(2)).toEqual(['EX', 12 * 60 * 60]);
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

  describe('reading the keyspace', () => {
    it('walks every SCAN page and never calls KEYS', async () => {
      // Pages of two: three round trips before the cursor comes back to 0.
      redis = fakeRedis(2);
      service = build();
      for (let i = 1; i <= 5; i += 1) {
        await service.setLocation(`tech-${i}`, { lat: i, lng: i });
      }

      const all = await service.listLocations();

      expect(all.map((l) => l.userId).sort()).toEqual(['tech-1', 'tech-2', 'tech-3', 'tech-4', 'tech-5']);
      const scan = redis.service.client.scan as jest.Mock;
      expect(scan).toHaveBeenCalledTimes(3);
      expect(scan.mock.calls[0]).toEqual(['0', 'MATCH', 'tech:location:*', 'COUNT', expect.any(Number)]);
      expect(redis.service.client.keys).not.toHaveBeenCalled();
    });

    // SCAN may hand the same key back on two pages; a technician is one pin.
    it('lists a key SCAN returns twice only once', async () => {
      await service.setLocation('tech-1', { lat: 1, lng: 1 });
      const scan = redis.service.client.scan as jest.Mock;
      scan
        .mockResolvedValueOnce(['7', ['tech:location:tech-1']])
        .mockResolvedValueOnce(['0', ['tech:location:tech-1']]);

      const all = await service.listLocations();

      expect(all).toHaveLength(1);
    });
  });

  describe('the card’s "Track location" and the user type', () => {
    it('accepts and drops a fix from a technician who is not tracked', async () => {
      service = build(['tech-1']);

      const stored = await service.setLocation('tech-1', { lat: 1, lng: 1 });

      expect(stored).toBeNull();
      expect(redis.store.size).toBe(0);
      expect(policy.isLocationTracked).toHaveBeenCalledWith('tech-1');
    });

    // A phone on an old build keeps posting after the manager turns tracking
    // off; its earlier fix must not stay on the map until it expires.
    it('a fix posted after tracking was switched off also removes the lingering one', async () => {
      await service.setLocation('tech-1', { lat: 1, lng: 1 });
      service = build(['tech-1']);

      await service.setLocation('tech-1', { lat: 2, lng: 2 });

      expect(await service.getLocation('tech-1')).toBeNull();
    });

    it('never lists a technician who is not tracked, even when a key lingers', async () => {
      await service.setLocation('tech-1', { lat: 1, lng: 1 });
      await service.setLocation('tech-2', { lat: 2, lng: 2 });
      service = build(['tech-2']);

      const all = await service.listLocations();

      expect(all.map((l) => l.userId)).toEqual(['tech-1']);
    });
  });
});
