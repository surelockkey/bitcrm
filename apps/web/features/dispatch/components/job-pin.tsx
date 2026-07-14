"use client";

import { AdvancedMarker } from "@vis.gl/react-google-maps";
import { cn } from "@/lib/utils";
import { stageTone } from "@/features/deals/lib";
import type { LocatedDeal } from "../lib";

/**
 * Pin colour by stage group, reusing the tokens the board and badges already use
 * so a deal reads the same everywhere. Unassigned work is red — per
 * `stories/4.01`, that is the colour dispatchers scan for.
 */
const TONE_CLASS: Record<string, string> = {
  submitted: "bg-sky-500",
  progress: "bg-blue-600",
  pending: "bg-amber-500",
  closed: "bg-zinc-400",
  canceled: "bg-zinc-300",
};

export function JobPin({
  deal,
  label,
  hovered,
  selected,
  onHover,
  onSelect,
}: {
  deal: LocatedDeal;
  label: string;
  hovered: boolean;
  selected: boolean;
  onHover: (id: string | null) => void;
  onSelect: (id: string) => void;
}) {
  const unassigned = !deal.assignedTechId;
  const color = unassigned ? "bg-red-600" : TONE_CLASS[stageTone(deal.stage)];
  const active = hovered || selected;

  return (
    <AdvancedMarker
      position={{ lat: deal.address.lat, lng: deal.address.lng }}
      title={label}
      zIndex={active ? 10 : 1}
      onMouseEnter={() => onHover(deal.id)}
      onMouseLeave={() => onHover(null)}
      onClick={() => onSelect(deal.id)}
    >
      <div
        data-testid={`job-pin-${deal.id}`}
        data-hovered={active ? "true" : "false"}
        className={cn(
          "size-4 cursor-pointer rounded-full border-2 border-white shadow-md transition-transform",
          color,
          active && "scale-150 ring-2 ring-foreground/40",
        )}
      />
    </AdvancedMarker>
  );
}
