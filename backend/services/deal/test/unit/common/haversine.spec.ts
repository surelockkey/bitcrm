import { distanceMeters, distanceMiles } from 'src/common/utils/haversine';

describe('Haversine Distance', () => {
  it('should return 0 for same coordinates', () => {
    expect(distanceMiles(33.749, -84.388, 33.749, -84.388)).toBe(0);
  });

  it('should calculate distance between Atlanta and Marietta (~20 miles)', () => {
    // Atlanta (33.749, -84.388) to Marietta (33.953, -84.550)
    const distance = distanceMiles(33.749, -84.388, 33.953, -84.550);
    expect(distance).toBeGreaterThan(15);
    expect(distance).toBeLessThan(25);
  });

  it('should calculate distance between Atlanta and Savannah (~248 miles)', () => {
    const distance = distanceMiles(33.749, -84.388, 32.081, -81.091);
    expect(distance).toBeGreaterThan(220);
    expect(distance).toBeLessThan(270);
  });

  it('should be symmetric', () => {
    const d1 = distanceMiles(33.749, -84.388, 32.081, -81.091);
    const d2 = distanceMiles(32.081, -81.091, 33.749, -84.388);
    expect(d1).toBeCloseTo(d2, 5);
  });
});

describe('distanceMeters', () => {
  /** One degree of latitude on the mean Earth sphere, in metres. */
  const M_PER_DEG_LAT = (6_371_000 * Math.PI) / 180;

  it('is 0 for the same point', () => {
    expect(distanceMeters(41.7637, -72.6851, 41.7637, -72.6851)).toBe(0);
  });

  it('measures a short hop in metres — 500 m due north is 500 m', () => {
    const north = 41.7637 + 500 / M_PER_DEG_LAT;
    expect(distanceMeters(41.7637, -72.6851, north, -72.6851)).toBeCloseTo(500, 6);
  });

  it('agrees with distanceMiles over a long distance (Atlanta → Savannah)', () => {
    const metres = distanceMeters(33.749, -84.388, 32.081, -81.091);
    const miles = distanceMiles(33.749, -84.388, 32.081, -81.091);
    // Two spheres a few hundred metres apart in radius: within 0.01 %.
    expect(metres / 1609.344 / miles).toBeCloseTo(1, 3);
  });
});
