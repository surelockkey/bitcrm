"use client";

import { useEffect } from "react";
import { useMap } from "@vis.gl/react-google-maps";
import type { ServiceArea } from "@bitcrm/types";
import { circleToPath } from "@/features/service-areas/lib";

/**
 * Distinct, map-legible colours, cycled by the area's position in the list.
 * Kept stable (sorted list → same colour) so the legend and the polygons agree.
 */
const AREA_COLORS = [
  "#2563eb", // blue
  "#16a34a", // green
  "#db2777", // pink
  "#f59e0b", // amber
  "#7c3aed", // violet
  "#0891b2", // cyan
  "#dc2626", // red
  "#4d7c0f", // lime
];

/** The colour a given area index draws with — shared by overlay and legend. */
export function areaColor(index: number): string {
  return AREA_COLORS[index % AREA_COLORS.length];
}

/** One area's coverage → a Google Maps path per shape (circles become 48-gons). */
function shapePaths(area: ServiceArea): google.maps.LatLngLiteral[][] {
  return area.coverage.map((shape) =>
    shape.kind === "circle"
      ? circleToPath(shape.lat, shape.lng, shape.radiusMiles)
      : shape.vertices,
  );
}

/**
 * Draws each service area's coverage as translucent polygons so dispatchers
 * see where jobs and technicians fall relative to the areas they belong to.
 * ZIP-radius circles and drawn polygons share one path via `circleToPath`.
 * Each coverage shape gets its own Polygon (not one Polygon with many paths) so
 * a multi-ZIP area's overlapping circles fill solidly instead of the even-odd
 * rule punching holes. Non-interactive (`clickable: false`) so it never steals
 * clicks from the job pins or technician markers layered on top.
 */
export function ServiceAreaOverlay({ areas }: { areas: ServiceArea[] }) {
  const map = useMap();

  useEffect(() => {
    if (!map) return;
    const polygons = areas.flatMap((area, i) => {
      const color = areaColor(i);
      const muted = !area.active; // inactive areas still show, just dimmed
      return shapePaths(area).map(
        (path) =>
          new google.maps.Polygon({
            map,
            paths: path,
            strokeColor: color,
            strokeOpacity: muted ? 0.4 : 0.9,
            strokeWeight: 2,
            fillColor: color,
            fillOpacity: muted ? 0.04 : 0.12,
            clickable: false,
            zIndex: 1,
          }),
      );
    });
    return () => polygons.forEach((p) => p.setMap(null));
  }, [map, areas]);

  return null;
}

/** Colour key for the drawn areas, overlaid in a corner of the map. */
export function ServiceAreaLegend({ areas }: { areas: ServiceArea[] }) {
  if (areas.length === 0) return null;
  return (
    <div className="absolute left-3 top-3 z-10 max-h-[45%] w-56 overflow-auto rounded-lg border bg-background/95 p-2.5 shadow-md backdrop-blur">
      <p className="mb-1.5 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Service areas
      </p>
      <ul className="space-y-0.5">
        {areas.map((area, i) => (
          <li key={area.id} className="flex items-center gap-2 rounded px-1 py-0.5 text-sm">
            <span
              className="size-3 shrink-0 rounded-sm"
              style={{ backgroundColor: areaColor(i) }}
            />
            <span className="truncate">{area.name}</span>
            {!area.active ? (
              <span className="ml-auto text-[10px] uppercase text-muted-foreground">off</span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
