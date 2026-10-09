import { ServiceAreaType, type ServiceArea, type CoverageShape } from "@bitcrm/types";

/**
 * Workiz's service-area colours, in its "Choose Color" order
 * (pg_settings_catalogs_wz_metroareas_add_open: CSS named colours, two rows).
 * Data, not theme: they are what an area's chip is painted with, as the
 * imported areas already are.
 */
export const WZ_AREA_COLORS: readonly { value: string; label: string; color: string }[] = [
  ["#7fffd4", "Aquamarine"], ["#1e90ff", "Dodger blue"], ["#6495ed", "Cornflower blue"], ["#008b8b", "Dark cyan"],
  ["#5f9ea0", "Cadet blue"], ["#00008b", "Dark blue"], ["#2e8b57", "Sea green"], ["#556b2f", "Dark olive green"],
  ["#8fbc8f", "Dark sea green"], ["#9acd32", "Yellow green"], ["#bdb76b", "Dark khaki"], ["#808000", "Olive"],
  ["#deb887", "Burlywood"], ["#d2b48c", "Tan"], ["#cd853f", "Peru"], ["#b8860b", "Dark goldenrod"],
  ["#d2691e", "Chocolate"], ["#a52a2a", "Brown"], ["#ffa500", "Orange"], ["#ff8c00", "Dark orange"],
  ["#ff6347", "Tomato"], ["#ff4500", "Orange red"], ["#dc143c", "Crimson"], ["#8b0000", "Dark red"],
  ["#ee82ee", "Violet"], ["#da70d6", "Orchid"], ["#db7093", "Pale violet red"], ["#bc8f8f", "Rosy brown"],
  ["#8a2be2", "Blue violet"], ["#191970", "Midnight blue"], ["#3cb371", "Medium sea green"], ["#008000", "Green"],
  ["#20b2aa", "Light sea green"], ["#4169e1", "Royal blue"], ["#2f4f4f", "Dark slate grey"], ["#708090", "Slate grey"],
  ["#f0e68c", "Khaki"], ["#000000", "Black"], ["#5e5e5e", "Grey"],
].map(([value, label]) => ({ value, label, color: value }));

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
