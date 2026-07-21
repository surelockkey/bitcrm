import { type CoverageShape, type GeoPoint } from '@bitcrm/types';
import { distanceMiles } from '../../common/utils/haversine';

type Circle = Extract<CoverageShape, { kind: 'circle' }>;

/** True when `p` lies within (or on) the circle. */
export function pointInCircle(p: GeoPoint, circle: Circle): boolean {
  return distanceMiles(p.lat, p.lng, circle.lat, circle.lng) <= circle.radiusMiles;
}

/**
 * Standard ray-casting test on lat/lng treated as planar coordinates — exact
 * for the small areas a dispatch territory spans. Vertices are an ordered ring;
 * the closing edge (last→first) is implied.
 */
export function pointInPolygon(p: GeoPoint, vertices: GeoPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const xi = vertices[i].lng;
    const yi = vertices[i].lat;
    const xj = vertices[j].lng;
    const yj = vertices[j].lat;

    const intersects =
      yi > p.lat !== yj > p.lat &&
      p.lng < ((xj - xi) * (p.lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** True when `p` lies inside a single coverage shape. */
export function pointInShape(p: GeoPoint, shape: CoverageShape): boolean {
  return shape.kind === 'circle'
    ? pointInCircle(p, shape)
    : pointInPolygon(p, shape.vertices);
}

/** True when `p` lies inside ANY shape of the coverage set. */
export function pointInCoverage(p: GeoPoint, coverage: CoverageShape[]): boolean {
  return coverage.some((shape) => pointInShape(p, shape));
}
