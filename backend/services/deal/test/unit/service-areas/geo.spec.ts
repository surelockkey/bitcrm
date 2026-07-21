import {
  pointInCircle,
  pointInPolygon,
  pointInShape,
  pointInCoverage,
} from 'src/service-areas/geo/point-in-area';
import { shapesOverlap, coveragesOverlap } from 'src/service-areas/geo/overlap';
import { type CoverageShape } from '@bitcrm/types';

// A 5-mile circle centered downtown Atlanta.
const circle = { kind: 'circle' as const, lat: 33.75, lng: -84.39, radiusMiles: 5 };

// A ~0.1deg square box around Atlanta.
const square: CoverageShape = {
  kind: 'polygon',
  vertices: [
    { lat: 33.7, lng: -84.4 },
    { lat: 33.7, lng: -84.3 },
    { lat: 33.8, lng: -84.3 },
    { lat: 33.8, lng: -84.4 },
  ],
};

describe('pointInCircle', () => {
  it('is true for a point within the radius', () => {
    // ~0.7 mile north of center
    expect(pointInCircle({ lat: 33.76, lng: -84.39 }, circle)).toBe(true);
  });

  it('is false for a point outside the radius', () => {
    // ~10 miles north
    expect(pointInCircle({ lat: 33.9, lng: -84.39 }, circle)).toBe(false);
  });

  it('includes points exactly on the boundary', () => {
    const c = { kind: 'circle' as const, lat: 0, lng: 0, radiusMiles: 69.172 };
    // 1 degree of latitude ≈ 69.172 miles
    expect(pointInCircle({ lat: 1, lng: 0 }, c)).toBe(true);
  });
});

describe('pointInPolygon', () => {
  it('is true for a point inside the box', () => {
    expect(pointInPolygon({ lat: 33.75, lng: -84.35 }, square.vertices as any)).toBe(true);
  });

  it('is false for a point outside the box', () => {
    expect(pointInPolygon({ lat: 33.75, lng: -84.5 }, square.vertices as any)).toBe(false);
  });

  it('is false for a point north of the box', () => {
    expect(pointInPolygon({ lat: 34.0, lng: -84.35 }, square.vertices as any)).toBe(false);
  });
});

describe('pointInShape / pointInCoverage', () => {
  it('dispatches to the right shape kind', () => {
    expect(pointInShape({ lat: 33.75, lng: -84.39 }, circle)).toBe(true);
    expect(pointInShape({ lat: 33.75, lng: -84.35 }, square)).toBe(true);
  });

  it('matches when inside any shape of the coverage', () => {
    const coverage = [circle, square];
    expect(pointInCoverage({ lat: 33.75, lng: -84.35 }, coverage)).toBe(true); // in square
    expect(pointInCoverage({ lat: 40.0, lng: -80.0 }, coverage)).toBe(false); // in neither
  });
});

describe('shapesOverlap', () => {
  it('detects two overlapping circles', () => {
    const a = { kind: 'circle' as const, lat: 33.75, lng: -84.39, radiusMiles: 5 };
    const b = { kind: 'circle' as const, lat: 33.76, lng: -84.39, radiusMiles: 5 };
    expect(shapesOverlap(a, b)).toBe(true);
  });

  it('detects two disjoint circles', () => {
    const a = { kind: 'circle' as const, lat: 33.75, lng: -84.39, radiusMiles: 5 };
    const b = { kind: 'circle' as const, lat: 34.5, lng: -84.39, radiusMiles: 5 };
    expect(shapesOverlap(a, b)).toBe(false);
  });

  it('detects two overlapping polygons', () => {
    const b: CoverageShape = {
      kind: 'polygon',
      vertices: [
        { lat: 33.75, lng: -84.35 },
        { lat: 33.75, lng: -84.25 },
        { lat: 33.85, lng: -84.25 },
        { lat: 33.85, lng: -84.35 },
      ],
    };
    expect(shapesOverlap(square, b)).toBe(true);
  });

  it('detects two disjoint polygons', () => {
    const b: CoverageShape = {
      kind: 'polygon',
      vertices: [
        { lat: 40.0, lng: -80.0 },
        { lat: 40.0, lng: -79.9 },
        { lat: 40.1, lng: -79.9 },
        { lat: 40.1, lng: -80.0 },
      ],
    };
    expect(shapesOverlap(square, b)).toBe(false);
  });

  it('detects a circle whose edge crosses a polygon even if its center is outside', () => {
    // Center ~2.9mi west of the box's -84.4 edge, radius 5mi → reaches into the box.
    const c = { kind: 'circle' as const, lat: 33.75, lng: -84.45, radiusMiles: 5 };
    expect(shapesOverlap(c, square)).toBe(true);
  });

  it('detects a circle fully clear of a polygon', () => {
    // Center ~11.5mi west of the -84.4 edge, radius 5mi → clear.
    const c = { kind: 'circle' as const, lat: 33.75, lng: -84.6, radiusMiles: 5 };
    expect(shapesOverlap(c, square)).toBe(false);
  });
});

describe('coveragesOverlap', () => {
  it('is true when any shape pair overlaps', () => {
    const a = [square];
    const b = [
      { kind: 'circle' as const, lat: 33.75, lng: -84.45, radiusMiles: 5 },
    ];
    expect(coveragesOverlap(a, b)).toBe(true);
  });

  it('is false when no shape pair overlaps', () => {
    const a = [square];
    const b = [
      { kind: 'circle' as const, lat: 40.0, lng: -80.0, radiusMiles: 3 },
    ];
    expect(coveragesOverlap(a, b)).toBe(false);
  });
});
