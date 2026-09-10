import {
  distanceToCoverageMiles,
  distanceToShapeMiles,
} from 'src/service-areas/geo/distance-to-area';
import { type CoverageShape } from '@bitcrm/types';

/**
 * Hartford, CT vs. Las Vegas, NV — the scenario the feature exists for: an
 * address in a state nobody serves must still rank the catalog by distance.
 */
const hartfordCircle: CoverageShape = {
  kind: 'circle',
  lat: 41.7658,
  lng: -72.6734,
  radiusMiles: 15,
};

// A rough square around New Haven, CT.
const newHavenPolygon: CoverageShape = {
  kind: 'polygon',
  vertices: [
    { lat: 41.35, lng: -73.0 },
    { lat: 41.35, lng: -72.85 },
    { lat: 41.25, lng: -72.85 },
    { lat: 41.25, lng: -73.0 },
  ],
};

describe('distanceToShapeMiles', () => {
  it('is zero inside a circle and its edge', () => {
    expect(distanceToShapeMiles({ lat: 41.7658, lng: -72.6734 }, hartfordCircle)).toBe(0);
  });

  it('is the gap beyond the radius outside a circle', () => {
    // ~24 miles Hartford → New Haven, minus the 15-mile radius ≈ 9-ish.
    const d = distanceToShapeMiles({ lat: 41.3083, lng: -72.9279 }, hartfordCircle);
    expect(d).toBeGreaterThan(5);
    expect(d).toBeLessThan(25);
  });

  it('is zero inside a polygon', () => {
    expect(distanceToShapeMiles({ lat: 41.3, lng: -72.93 }, newHavenPolygon)).toBe(0);
  });

  it('measures to the nearest polygon edge, not a vertex', () => {
    // Due east of the polygon's right edge midpoint.
    const d = distanceToShapeMiles({ lat: 41.3, lng: -72.7 }, newHavenPolygon);
    expect(d).toBeGreaterThan(5);
    expect(d).toBeLessThan(12);
  });
});

describe('distanceToCoverageMiles', () => {
  it('takes the closest of several shapes', () => {
    const vegas = { lat: 36.1699, lng: -115.1398 };
    const toHartford = distanceToShapeMiles(vegas, hartfordCircle);
    const toNewHaven = distanceToShapeMiles(vegas, newHavenPolygon);
    expect(distanceToCoverageMiles(vegas, [hartfordCircle, newHavenPolygon])).toBe(
      Math.min(toHartford, toNewHaven),
    );
    // Cross-country sanity: Vegas is ~2,200 miles from Connecticut.
    expect(toHartford).toBeGreaterThan(2000);
    expect(toHartford).toBeLessThan(2600);
  });

  it('is Infinity for empty coverage', () => {
    expect(distanceToCoverageMiles({ lat: 0, lng: 0 }, [])).toBe(Infinity);
  });
});
