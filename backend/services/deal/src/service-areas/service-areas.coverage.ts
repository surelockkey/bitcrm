import { BadRequestException } from '@nestjs/common';
import {
  ServiceAreaType,
  type CoverageShape,
  type GeoPoint,
  type ServiceAreaDefinition,
} from '@bitcrm/types';
import { DEFAULT_ZIP_RADIUS_MILES } from './service-areas.constants';

/** Resolves a ZIP code to its centroid; returns null when unresolvable. */
export type ZipGeocoder = (zip: string) => Promise<GeoPoint | null>;

/**
 * Turns the raw definition a dispatcher entered into the normalized coverage
 * shapes every match/overlap check runs on. ZIP entries are geocoded to
 * centroid circles (buffered by their radius or the service default); a polygon
 * passes straight through. Throws `BadRequestException` when a ZIP can't be
 * geocoded, so an area is never persisted with silently-missing geometry.
 */
export async function deriveCoverage(
  definition: ServiceAreaDefinition,
  geocodeZip: ZipGeocoder,
): Promise<CoverageShape[]> {
  if (definition.type === ServiceAreaType.POLYGON) {
    if (!definition.vertices || definition.vertices.length < 3) {
      throw new BadRequestException('A polygon service area needs at least 3 points');
    }
    return [{ kind: 'polygon', vertices: definition.vertices }];
  }

  if (!definition.zips || definition.zips.length === 0) {
    throw new BadRequestException('A zip service area needs at least 1 ZIP code');
  }

  const shapes: CoverageShape[] = [];
  for (const entry of definition.zips) {
    const point = await geocodeZip(entry.zip);
    if (!point) {
      throw new BadRequestException(`Could not geocode ZIP ${entry.zip}`);
    }
    shapes.push({
      kind: 'circle',
      lat: point.lat,
      lng: point.lng,
      radiusMiles: entry.radiusMiles ?? DEFAULT_ZIP_RADIUS_MILES,
    });
  }
  return shapes;
}
