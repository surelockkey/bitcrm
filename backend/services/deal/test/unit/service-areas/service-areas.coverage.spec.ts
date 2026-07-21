import { deriveCoverage } from 'src/service-areas/service-areas.coverage';
import { ServiceAreaType, type ServiceAreaDefinition } from '@bitcrm/types';

describe('deriveCoverage', () => {
  it('geocodes each ZIP into a circle with the given radius', async () => {
    const geocode = jest.fn().mockResolvedValue({ lat: 33.75, lng: -84.39 });
    const def: ServiceAreaDefinition = {
      type: ServiceAreaType.ZIPS,
      zips: [{ zip: '30301', radiusMiles: 10 }],
    };

    const coverage = await deriveCoverage(def, geocode);

    expect(geocode).toHaveBeenCalledWith('30301');
    expect(coverage).toEqual([
      { kind: 'circle', lat: 33.75, lng: -84.39, radiusMiles: 10 },
    ]);
  });

  it('applies the default radius when a ZIP omits +N miles', async () => {
    const geocode = jest.fn().mockResolvedValue({ lat: 1, lng: 2 });
    const def: ServiceAreaDefinition = {
      type: ServiceAreaType.ZIPS,
      zips: [{ zip: '30301' }],
    };

    const [circle] = await deriveCoverage(def, geocode);

    expect(circle).toEqual({ kind: 'circle', lat: 1, lng: 2, radiusMiles: 3 });
  });

  it('builds one circle per ZIP in a list', async () => {
    const geocode = jest
      .fn()
      .mockResolvedValueOnce({ lat: 1, lng: 1 })
      .mockResolvedValueOnce({ lat: 2, lng: 2 });
    const def: ServiceAreaDefinition = {
      type: ServiceAreaType.ZIPS,
      zips: [{ zip: 'a' }, { zip: 'b' }],
    };

    const coverage = await deriveCoverage(def, geocode);

    expect(coverage).toHaveLength(2);
  });

  it('throws when a ZIP cannot be geocoded', async () => {
    const geocode = jest.fn().mockResolvedValue(null);
    const def: ServiceAreaDefinition = {
      type: ServiceAreaType.ZIPS,
      zips: [{ zip: 'nowhere' }],
    };

    await expect(deriveCoverage(def, geocode)).rejects.toThrow(/geocode ZIP nowhere/);
  });

  it('passes a polygon through as a single polygon shape', async () => {
    const geocode = jest.fn();
    const vertices = [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 1 },
      { lat: 1, lng: 1 },
    ];
    const def: ServiceAreaDefinition = { type: ServiceAreaType.POLYGON, vertices };

    const coverage = await deriveCoverage(def, geocode);

    expect(coverage).toEqual([{ kind: 'polygon', vertices }]);
    expect(geocode).not.toHaveBeenCalled();
  });

  it('rejects a polygon with fewer than 3 points', async () => {
    const def: ServiceAreaDefinition = {
      type: ServiceAreaType.POLYGON,
      vertices: [{ lat: 0, lng: 0 }, { lat: 1, lng: 1 }],
    };
    await expect(deriveCoverage(def, jest.fn())).rejects.toThrow(/at least 3 points/);
  });
});
