import { type CoverageShape, type GeoPoint } from '@bitcrm/types';
import { distanceMiles } from '../../common/utils/haversine';
import { pointInPolygon } from './point-in-area';

type Circle = Extract<CoverageShape, { kind: 'circle' }>;

/**
 * How far a point is from a coverage shape, in miles — zero inside it.
 *
 * This is what ranks the catalog for an address nobody serves (a Nevada
 * lockout against Connecticut markets): resolve answers "which area contains
 * this point", this answers "which area is closest to it".
 */
export function distanceToShapeMiles(p: GeoPoint, shape: CoverageShape): number {
  if (shape.kind === 'circle') {
    return Math.max(
      0,
      distanceMiles(p.lat, p.lng, shape.lat, shape.lng) - shape.radiusMiles,
    );
  }
  if (pointInPolygon(p, shape.vertices)) return 0;
  let min = Infinity;
  for (let i = 0, j = shape.vertices.length - 1; i < shape.vertices.length; j = i++) {
    min = Math.min(min, distanceToSegmentMiles(p, shape.vertices[j], shape.vertices[i]));
  }
  return min;
}

/** The closest of a coverage set; Infinity when there are no shapes. */
export function distanceToCoverageMiles(p: GeoPoint, coverage: CoverageShape[]): number {
  return coverage.reduce(
    (min, shape) => Math.min(min, distanceToShapeMiles(p, shape)),
    Infinity,
  );
}

/**
 * Point-to-segment distance on a local flat projection (longitude scaled by
 * cos(latitude)), then measured with the haversine. Exact enough at dispatch
 * scale, and the error at continental scale can't reorder a 2,000-mile gap.
 */
function distanceToSegmentMiles(p: GeoPoint, a: GeoPoint, b: GeoPoint): number {
  const scale = Math.cos((p.lat * Math.PI) / 180);
  const ax = a.lng * scale;
  const ay = a.lat;
  const bx = b.lng * scale;
  const by = b.lat;
  const px = p.lng * scale;
  const py = p.lat;

  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  const t =
    lengthSq === 0
      ? 0
      : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq));

  const nearest: GeoPoint = {
    lat: ay + t * dy,
    lng: (ax + t * dx) / scale,
  };
  return distanceMiles(p.lat, p.lng, nearest.lat, nearest.lng);
}
