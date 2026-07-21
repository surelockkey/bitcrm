import { ServiceAreaType, type ServiceArea, type CoverageShape } from "@bitcrm/types";

/** Short human summary of an area's geometry for tables/lists. */
export function describeArea(area: ServiceArea): string {
  if (area.type === ServiceAreaType.POLYGON) {
    const pts =
      area.definition.type === ServiceAreaType.POLYGON
        ? area.definition.vertices.length
        : 0;
    return `Polygon · ${pts} point${pts === 1 ? "" : "s"}`;
  }
  const zips = area.definition.type === ServiceAreaType.ZIPS ? area.definition.zips : [];
  if (zips.length === 1) {
    const z = zips[0];
    return z.radiusMiles ? `ZIP ${z.zip} + ${z.radiusMiles} mi` : `ZIP ${z.zip}`;
  }
  return `${zips.length} ZIP code${zips.length === 1 ? "" : "s"}`;
}

/** Center a Google Map on an area's coverage — average of shape anchor points. */
export function coverageCenter(
  coverage: CoverageShape[],
): { lat: number; lng: number } | null {
  const points: Array<{ lat: number; lng: number }> = [];
  for (const shape of coverage) {
    if (shape.kind === "circle") points.push({ lat: shape.lat, lng: shape.lng });
    else for (const v of shape.vertices) points.push({ lat: v.lat, lng: v.lng });
  }
  if (points.length === 0) return null;
  const lat = points.reduce((s, p) => s + p.lat, 0) / points.length;
  const lng = points.reduce((s, p) => s + p.lng, 0) / points.length;
  return { lat, lng };
}

/** Approx miles → degrees latitude, for drawing a circle as a rough polygon. */
const MILES_PER_DEG_LAT = 69.172;

/** A circle rendered as a 48-gon so it can share the Polygon draw path. */
export function circleToPath(
  lat: number,
  lng: number,
  radiusMiles: number,
  steps = 48,
): Array<{ lat: number; lng: number }> {
  const dLat = radiusMiles / MILES_PER_DEG_LAT;
  const dLng = radiusMiles / (MILES_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180));
  return Array.from({ length: steps }, (_, i) => {
    const t = (i / steps) * 2 * Math.PI;
    return { lat: lat + dLat * Math.sin(t), lng: lng + dLng * Math.cos(t) };
  });
}
