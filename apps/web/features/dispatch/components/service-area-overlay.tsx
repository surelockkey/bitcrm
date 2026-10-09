"use client";

import { useEffect, useState } from "react";
import { useMap } from "@vis.gl/react-google-maps";
import { ChevronDown } from "lucide-react";
import { wzPinInk } from "@/components/workiz/map-pin";
import { cn } from "@/lib/utils";
import type { ServiceArea } from "@bitcrm/types";
import { circleToPath } from "@/features/service-areas/lib";
import { scheduleColor } from "@/features/schedule/calendar";

/**
 * An area's colour: its own Workiz colour when it carries one (imported
 * areas do), else the one the Schedule gives it — so the map, the legend and
 * the Schedule's area chips agree.
 */
export function areaColor(area: Pick<ServiceArea, "name" | "color">): string {
  return area.color ?? scheduleColor(area.name);
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
 * clicks from the pins layered on top.
 */
export function ServiceAreaOverlay({ areas }: { areas: ServiceArea[] }) {
  const map = useMap();

  useEffect(() => {
    if (!map) return;
    const polygons = areas.flatMap((area) => {
      const color = areaColor(area);
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

/**
 * The areas' key — ours (Workiz's map has no area layer). Folded by default to
 * one white 8px-cornered button at the map's bottom-left, above Google's mark,
 * so the map reads as Workiz's; open, it lists each area as Workiz draws one
 * wherever it lists areas: a chip of 14px/500 words on the area's colour,
 * 22px tall, 3px corners (ink words on the light colours, so they read).
 */
export function ServiceAreaLegend({ areas }: { areas: ServiceArea[] }) {
  const [open, setOpen] = useState(false);
  if (areas.length === 0) return null;
  return (
    <div className="absolute bottom-8 left-3 z-10 flex max-h-[40%] max-w-[320px] flex-col overflow-hidden rounded-[8px] bg-white shadow-[0_4px_16px_rgba(0,0,0,0.15)]">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-[13px] leading-[19px] font-semibold tracking-[0.4px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        Service areas ({areas.length})
        <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} strokeWidth={1.6} />
      </button>
      {open ? (
        <ul aria-label="Service areas" className="flex flex-wrap gap-1 overflow-auto px-3 pb-3">
          {areas.map((area) => {
            const fill = areaColor(area);
            return (
              <li
                key={area.id}
                title={area.active ? area.name : `${area.name} (off)`}
                style={{ backgroundColor: fill }}
                className={cn(
                  "inline-flex h-[22px] items-center rounded-[3px] px-1.5 text-sm font-medium",
                  wzPinInk(fill) ? "text-foreground" : "text-white",
                  !area.active && "opacity-50",
                )}
              >
                {area.name}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
