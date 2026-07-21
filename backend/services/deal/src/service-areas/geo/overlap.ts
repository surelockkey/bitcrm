import { type CoverageShape, type GeoPoint } from '@bitcrm/types';
import { distanceMiles } from '../../common/utils/haversine';
import { pointInCircle, pointInPolygon } from './point-in-area';

type Circle = Extract<CoverageShape, { kind: 'circle' }>;
type Polygon = Extract<CoverageShape, { kind: 'polygon' }>;

const MILES_PER_DEG_LAT = 69.172;

/** Project lat/lng to local planar miles around an origin (equirectangular). */
function toLocalMiles(p: GeoPoint, origin: GeoPoint): { x: number; y: number } {
  const milesPerDegLng = MILES_PER_DEG_LAT * Math.cos((origin.lat * Math.PI) / 180);
  return {
    x: (p.lng - origin.lng) * milesPerDegLng,
    y: (p.lat - origin.lat) * MILES_PER_DEG_LAT,
  };
}

/** Distance in miles from a point to a segment, in the point's local frame. */
function pointToSegmentMiles(p: GeoPoint, a: GeoPoint, b: GeoPoint): number {
  const pa = toLocalMiles(a, p);
  const pb = toLocalMiles(b, p);
  const dx = pb.x - pa.x;
  const dy = pb.y - pa.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(pa.x, pa.y);
  // Projection factor of origin (the point itself, at 0,0) onto segment ab.
  let t = -(pa.x * dx + pa.y * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = pa.x + t * dx;
  const cy = pa.y + t * dy;
  return Math.hypot(cx, cy);
}

/** Do segments p1p2 and p3p4 intersect (planar lat/lng)? */
function segmentsIntersect(p1: GeoPoint, p2: GeoPoint, p3: GeoPoint, p4: GeoPoint): boolean {
  const d = (a: GeoPoint, b: GeoPoint, c: GeoPoint) =>
    (b.lng - a.lng) * (c.lat - a.lat) - (b.lat - a.lat) * (c.lng - a.lng);
  const d1 = d(p3, p4, p1);
  const d2 = d(p3, p4, p2);
  const d3 = d(p1, p2, p3);
  const d4 = d(p1, p2, p4);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
      ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }
  return false;
}

function edges(vertices: GeoPoint[]): Array<[GeoPoint, GeoPoint]> {
  return vertices.map((v, i) => [v, vertices[(i + 1) % vertices.length]]);
}

function circlesOverlap(a: Circle, b: Circle): boolean {
  return distanceMiles(a.lat, a.lng, b.lat, b.lng) <= a.radiusMiles + b.radiusMiles;
}

function circlePolygonOverlap(c: Circle, poly: Polygon): boolean {
  const center = { lat: c.lat, lng: c.lng };
  // Center inside polygon, or any vertex inside circle, or an edge within radius.
  if (pointInPolygon(center, poly.vertices)) return true;
  if (poly.vertices.some((v) => pointInCircle(v, c))) return true;
  return edges(poly.vertices).some(
    ([a, b]) => pointToSegmentMiles(center, a, b) <= c.radiusMiles,
  );
}

function polygonsOverlap(a: Polygon, b: Polygon): boolean {
  // One contains a vertex of the other, or their edges cross.
  if (a.vertices.some((v) => pointInPolygon(v, b.vertices))) return true;
  if (b.vertices.some((v) => pointInPolygon(v, a.vertices))) return true;
  return edges(a.vertices).some(([a1, a2]) =>
    edges(b.vertices).some(([b1, b2]) => segmentsIntersect(a1, a2, b1, b2)),
  );
}

/** True when two coverage shapes intersect geographically. */
export function shapesOverlap(a: CoverageShape, b: CoverageShape): boolean {
  if (a.kind === 'circle' && b.kind === 'circle') return circlesOverlap(a, b);
  if (a.kind === 'circle' && b.kind === 'polygon') return circlePolygonOverlap(a, b);
  if (a.kind === 'polygon' && b.kind === 'circle') return circlePolygonOverlap(b, a);
  return polygonsOverlap(a as Polygon, b as Polygon);
}

/** True when any shape of coverage `a` overlaps any shape of coverage `b`. */
export function coveragesOverlap(a: CoverageShape[], b: CoverageShape[]): boolean {
  return a.some((sa) => b.some((sb) => shapesOverlap(sa, sb)));
}
