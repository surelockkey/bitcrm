"use client";

import { AdvancedMarker } from "@vis.gl/react-google-maps";
import { cn } from "@/lib/utils";
import { techColor } from "../tech-color";
import type { LocatedDeal } from "../lib";

/**
 * A job pin. Unassigned work is red — per `stories/4.01`, that is the colour
 * dispatchers scan for. An assigned job takes its technician's stable colour
 * (`4.01:70`), so a whole route reads as one colour on the map.
 */
export function JobPin({
  deal,
  label,
  hovered,
  selected,
  onHover,
  onSelect,
  markerRef,
}: {
  deal: LocatedDeal;
  label: string;
  hovered: boolean;
  selected: boolean;
  onHover: (id: string | null) => void;
  onSelect: (id: string) => void;
  /** Registers this pin with the clusterer so dense areas fold into one circle. */
  markerRef?: (marker: google.maps.marker.AdvancedMarkerElement | null) => void;
}) {
  // A deal can carry several techs; the pin takes the first one's colour and
  // that technician's position in their own day.
  const primaryTechId = deal.assignedTechIds[0];
  const unassigned = !primaryTechId;
  const active = hovered || selected;
  // The sequence badge only makes sense on assigned, numbered work.
  const seq = primaryTechId ? deal.sequences?.[primaryTechId] : undefined;

  return (
    <AdvancedMarker
      ref={markerRef}
      position={{ lat: deal.address.lat, lng: deal.address.lng }}
      title={seq ? `[${seq}] ${label}` : label}
      zIndex={active ? 10 : 1}
      onMouseEnter={() => onHover(deal.id)}
      onMouseLeave={() => onHover(null)}
      onClick={() => onSelect(deal.id)}
    >
      <div className="relative">
        <div
          data-testid={`job-pin-${deal.id}`}
          data-hovered={active ? "true" : "false"}
          data-assigned={unassigned ? "false" : "true"}
          style={primaryTechId ? { backgroundColor: techColor(primaryTechId) } : undefined}
          className={cn(
            "size-4 cursor-pointer rounded-full border-2 border-white shadow-md transition-transform",
            unassigned && "bg-red-600",
            active && "scale-150 ring-2 ring-foreground/40",
          )}
        />
        {seq ? (
          <span
            data-testid={`job-seq-${deal.id}`}
            className="pointer-events-none absolute -right-1.5 -top-1.5 flex min-w-3.5 items-center justify-center rounded-full border border-white bg-foreground px-1 text-[9px] font-semibold leading-3.5 text-background"
          >
            {seq}
          </span>
        ) : null}
      </div>
    </AdvancedMarker>
  );
}
