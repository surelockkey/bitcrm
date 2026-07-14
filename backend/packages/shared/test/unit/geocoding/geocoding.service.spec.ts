import { GeocodingService } from '../../../src/geocoding/geocoding.service';
import { type RedisService } from '../../../src/redis/redis.service';

const ADDRESS = {
  street: '123 Peachtree St',
  city: 'Atlanta',
  state: 'GA',
  zip: '30303',
};

function okResponse(lat: number, lng: number) {
  return {
    ok: true,
    json: async () => ({
      status: 'OK',
      results: [{ geometry: { location: { lat, lng } } }],
    }),
  } as unknown as Response;
}

/** Redis double: a plain Map, so we can assert on real cache behaviour. */
function fakeRedis() {
  const store = new Map<string, string>();
  return {
    store,
    service: {
      client: {
        get: jest.fn(async (k: string) => store.get(k) ?? null),
        set: jest.fn(async (k: string, v: string) => {
          store.set(k, v);
          return 'OK';
        }),
      },
    } as unknown as RedisService,
  };
}

describe('GeocodingService', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-key';
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    delete process.env.GOOGLE_MAPS_API_KEY;
    jest.restoreAllMocks();
  });

  it('resolves an address to coordinates', async () => {
    const redis = fakeRedis();
    fetchMock.mockResolvedValue(okResponse(33.749, -84.388));
    const service = new GeocodingService(redis.service);

    await expect(service.geocode(ADDRESS)).resolves.toEqual({
      lat: 33.749,
      lng: -84.388,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('serves a repeat lookup from cache without calling the API again', async () => {
    const redis = fakeRedis();
    fetchMock.mockResolvedValue(okResponse(33.749, -84.388));
    const service = new GeocodingService(redis.service);

    await service.geocode(ADDRESS);
    await service.geocode(ADDRESS);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('treats addresses differing only in case and whitespace as one cache entry', async () => {
    const redis = fakeRedis();
    fetchMock.mockResolvedValue(okResponse(33.749, -84.388));
    const service = new GeocodingService(redis.service);

    await service.geocode(ADDRESS);
    await service.geocode({
      street: '  123 PEACHTREE st ',
      city: 'atlanta',
      state: 'ga',
      zip: '30303 ',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // A bad address must not take down a deal save — the deal is stored without
  // coordinates and simply does not appear on the dispatch map.
  it('returns null when the address cannot be resolved, without throwing', async () => {
    const redis = fakeRedis();
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'ZERO_RESULTS', results: [] }),
    } as unknown as Response);
    const service = new GeocodingService(redis.service);

    await expect(service.geocode(ADDRESS)).resolves.toBeNull();
  });

  // Otherwise a single typo'd address re-bills us on every save and every
  // backfill pass, since only successes were being cached.
  it('does not re-query the API for an address already known to be unresolvable', async () => {
    const redis = fakeRedis();
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'ZERO_RESULTS', results: [] }),
    } as unknown as Response);
    const service = new GeocodingService(redis.service);

    await expect(service.geocode(ADDRESS)).resolves.toBeNull();
    await expect(service.geocode(ADDRESS)).resolves.toBeNull();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns null when the geocoding API errors, without throwing', async () => {
    const redis = fakeRedis();
    fetchMock.mockRejectedValue(new Error('network down'));
    const service = new GeocodingService(redis.service);

    await expect(service.geocode(ADDRESS)).resolves.toBeNull();
  });

  it('returns null and never calls the API when no key is configured', async () => {
    delete process.env.GOOGLE_MAPS_API_KEY;
    const redis = fakeRedis();
    const service = new GeocodingService(redis.service);

    await expect(service.geocode(ADDRESS)).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
