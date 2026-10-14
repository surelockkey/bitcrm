import { ServiceAreasBackfill } from 'src/service-areas/service-areas.backfill';

/**
 * With no geocoding key every boot retried every ZIP area and logged a
 * warning for each (≈14 areas × 32 boots in one week). Without a key there is
 * nothing to heal, so the self-heal does not run at all.
 */
describe('ServiceAreasBackfill', () => {
  const zipArea = { id: 'a1', definition: { type: 'zip', zips: ['06515'] }, coverage: [] };

  it('does nothing when geocoding is not configured', async () => {
    const repository = { listAll: jest.fn(async () => [zipArea]), put: jest.fn() };
    const geocoding = { enabled: false, geocode: jest.fn() };
    await new ServiceAreasBackfill(repository as never, geocoding as never).onModuleInit();
    expect(repository.listAll).not.toHaveBeenCalled();
    expect(geocoding.geocode).not.toHaveBeenCalled();
  });

  it('heals stale areas when it is', async () => {
    const repository = { listAll: jest.fn(async () => [zipArea]), put: jest.fn() };
    const geocoding = { enabled: true, geocode: jest.fn(async () => ({ lat: 41.3, lng: -72.9 })) };
    await new ServiceAreasBackfill(repository as never, geocoding as never).onModuleInit();
    expect(repository.listAll).toHaveBeenCalled();
    expect(geocoding.geocode).toHaveBeenCalled();
  });
});
