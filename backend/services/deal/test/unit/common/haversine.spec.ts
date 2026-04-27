import { distanceMiles } from 'src/common/utils/haversine';

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
