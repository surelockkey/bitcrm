"use client";

import { useRef, type ReactNode } from "react";
import { AdvancedMarker } from "@vis.gl/react-google-maps";
import { WzMapPin, wzPinInitials } from "@/components/workiz/map-pin";
import { scheduleColor } from "@/features/schedule/calendar";
import type { LocatedDeal } from "../lib";

/** How long after a press inside the card a marker click is the card's, not the pin's. */
const CARD_PRESS_MS = 1000;

/**
 * A job's pin, as Workiz draws it (pg_dispatch_wz_02): "color-coded by
 * technician" — the first tech's colour (the Schedule's `scheduleColor`, so a
 * tech reads the same on both pages) with their initials, a "+N" pin for
 * the rest of the crew, slate with the blocked-person glyph when nobody is
 * on it. Hovered — on the map or in the list — it shows the tech's name;
 * picked, its card hangs over it.
 */
export function JobPin({
  deal,
  techNames,
  hovered,
  selected,
  onHover,
  onSelect,
  card,
}: {
  deal: LocatedDeal;
  /** The crew's names, first tech first. */
  techNames: string[];
  hovered: boolean;
  selected: boolean;
  onHover: (id: string | null) => void;
  onSelect: (id: string) => void;
  /** The pin's card, drawn while it is picked. */
  card?: ReactNode;
}) {
  const primary = deal.assignedTechIds[0];
  // A press inside the card bubbles up to the marker as a click on the pin;
  // remember it so that click does not re-pick (and re-centre) the job.
  const cardPressedAt = useRef(0);
  return (
    <AdvancedMarker
      position={{ lat: deal.address.lat, lng: deal.address.lng }}
      zIndex={selected ? 1000 : hovered ? 900 : 1}
      onMouseEnter={() => onHover(deal.id)}
      onMouseLeave={() => onHover(null)}
      onClick={() => {
        if (Date.now() - cardPressedAt.current < CARD_PRESS_MS) return;
        onSelect(deal.id);
      }}
    >
      <div
        data-testid={`job-pin-${deal.id}`}
        data-hovered={hovered || selected ? "true" : "false"}
        data-assigned={primary ? "true" : "false"}
      >
        <WzMapPin
          color={primary ? scheduleColor(primary) : undefined}
          label={wzPinInitials(techNames[0])}
          name={techNames.length ? techNames.join(", ") : "Unassigned"}
          more={Math.max(0, deal.assignedTechIds.length - 1)}
          tooltip={hovered && !selected}
        >
          {selected && card ? (
            <div className="contents" onPointerDownCapture={() => (cardPressedAt.current = Date.now())}>
              {card}
            </div>
          ) : null}
        </WzMapPin>
      </div>
    </AdvancedMarker>
  );
}
