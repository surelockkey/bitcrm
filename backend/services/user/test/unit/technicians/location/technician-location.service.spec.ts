import { TechnicianLocationService } from '../../../../src/technicians/location/technician-location.service';
import { type RedisService } from '@bitcrm/shared';
import {
  HEARTBEAT_INTERVAL_MS,
  MIN_SAMPLE_INTERVAL_MS,
} from '../../../../src/technicians/location/technician-location.util';

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
  let repository: { append: jest.Mock; listInRange: jest.Mock };
  let timeClock: { openEntryId: jest.Mock };
  let service: TechnicianLocationService;

  beforeEach(() => {
    redis = fakeRedis();
    repository = {
      append: jest.fn().mockResolvedValue(undefined),
      listInRange: jest.fn().mockResolvedValue([]),
    };
    // On the clock by default — the presence tests below are unaffected either
    // way, and the track tests say explicitly which state they mean.
    timeClock = { openEntryId: jest.fn().mockResolvedValue('tc-1') };
    service = new TechnicianLocationService(
      redis.service,
      repository as never,
      timeClock as never,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
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

  /**
   * The stored trail behind the live dot. Presence is a value that gets
   * overwritten; the track is rows that cost money, so the rules about which
   * fixes earn one are the ones worth pinning.
   */
  describe('track', () => {
    const START = '2026-09-17T08:00:00.000Z';
    const at = (ms: number) => new Date(Date.parse(START) + ms);

    beforeEach(() => {
      jest.useFakeTimers().setSystemTime(new Date(START));
    });

    it('keeps the first fix of a shift, stamped with the running entry', async () => {
      await service.setLocation('tech-1', { lat: 33.749, lng: -84.388, accuracy: 12 });

      expect(repository.append).toHaveBeenCalledTimes(1);
      expect(repository.append.mock.calls[0][0]).toEqual({
        userId: 'tech-1',
        recordedAt: START,
        lat: 33.749,
        lng: -84.388,
        accuracy: 12,
        timeClockEntryId: 'tc-1',
      });
    });

    // Off the clock the company has no business keeping a map of his day —
    // presence still updates, so dispatch can still see him if he is online.
    it('stores nothing while the technician is off the clock', async () => {
      timeClock.openEntryId.mockResolvedValue(null);

      await service.setLocation('tech-1', { lat: 33.749, lng: -84.388 });

      expect(repository.append).not.toHaveBeenCalled();
      expect(await service.getLocation('tech-1')).toMatchObject({ lat: 33.749 });
    });

    it('drops the ticks between samples — the phone reports far faster than we store', async () => {
      await service.setLocation('tech-1', { lat: 33.749, lng: -84.388 });
      jest.setSystemTime(at(5_000));
      await service.setLocation('tech-1', { lat: 33.76, lng: -84.4 });
      jest.setSystemTime(at(10_000));
      await service.setLocation('tech-1', { lat: 33.77, lng: -84.41 });

      expect(repository.append).toHaveBeenCalledTimes(1);
    });

    it('keeps a second point once a minute has passed and he has driven a block', async () => {
      await service.setLocation('tech-1', { lat: 33.749, lng: -84.388 });
      jest.setSystemTime(at(MIN_SAMPLE_INTERVAL_MS));
      await service.setLocation('tech-1', { lat: 33.75, lng: -84.388 });

      expect(repository.append).toHaveBeenCalledTimes(2);
      expect(repository.append.mock.calls[1][0].recordedAt).toBe(at(MIN_SAMPLE_INTERVAL_MS).toISOString());
    });

    it('keeps a heartbeat for a van parked outside a client’s house', async () => {
      await service.setLocation('tech-1', { lat: 33.749, lng: -84.388 });
      jest.setSystemTime(at(HEARTBEAT_INTERVAL_MS));
      await service.setLocation('tech-1', { lat: 33.749, lng: -84.388 });

      expect(repository.append).toHaveBeenCalledTimes(2);
    });

    it('asks the clock only about fixes that survived sampling', async () => {
      await service.setLocation('tech-1', { lat: 33.749, lng: -84.388 });
      jest.setSystemTime(at(5_000));
      await service.setLocation('tech-1', { lat: 33.76, lng: -84.4 });

      expect(timeClock.openEntryId).toHaveBeenCalledTimes(1);
    });

    // A man who leaves the app running after his shift still reports a fix
    // every few seconds. Sampling has to throttle the clock lookup for him too
    // — otherwise every one of those pings is a DynamoDB read, all day, for a
    // row that is never written.
    it('throttles the clock lookup off the clock, not only on it', async () => {
      timeClock.openEntryId.mockResolvedValue(null);

      // A minute of five-second pings, 0s…60s inclusive.
      for (let i = 0; i <= 12; i++) {
        jest.setSystemTime(at(i * 5_000));
        await service.setLocation('tech-1', { lat: 33.749 + i * 0.01, lng: -84.388 });
      }

      expect(repository.append).not.toHaveBeenCalled();
      // Thirteen pings, two lookups: the first fix, then the minute mark.
      expect(timeClock.openEntryId).toHaveBeenCalledTimes(2);
    });

    it('starts the trail at the first sample after he clocks in', async () => {
      timeClock.openEntryId.mockResolvedValue(null);
      await service.setLocation('tech-1', { lat: 33.749, lng: -84.388 });
      expect(repository.append).not.toHaveBeenCalled();

      timeClock.openEntryId.mockResolvedValue('tc-9');
      jest.setSystemTime(at(MIN_SAMPLE_INTERVAL_MS));
      await service.setLocation('tech-1', { lat: 33.76, lng: -84.4 });

      expect(repository.append).toHaveBeenCalledTimes(1);
      expect(repository.append.mock.calls[0][0].timeClockEntryId).toBe('tc-9');
    });

    // Dispatch is looking at the map right now; a breadcrumb that failed to
    // store must not take the live position down with it.
    it('still reports presence when the track write fails', async () => {
      repository.append.mockRejectedValue(new Error('throttled'));

      const location = await service.setLocation('tech-1', { lat: 33.749, lng: -84.388 });

      expect(location.lat).toBe(33.749);
      expect(await service.getLocation('tech-1')).toMatchObject({ lat: 33.749 });
    });

    it('restarts sampling after going offline, instead of waiting out yesterday', async () => {
      await service.setLocation('tech-1', { lat: 33.749, lng: -84.388 });
      await service.clearLocation('tech-1');
      jest.setSystemTime(at(5_000));
      await service.setLocation('tech-1', { lat: 33.749, lng: -84.388 });

      expect(repository.append).toHaveBeenCalledTimes(2);
    });

    it('reads a technician’s trail back over a range', async () => {
      await service.listHistory('tech-1', '2026-09-17', '2026-09-17');
      expect(repository.listInRange).toHaveBeenCalledWith('tech-1', '2026-09-17', '2026-09-17');
    });
  });
});
