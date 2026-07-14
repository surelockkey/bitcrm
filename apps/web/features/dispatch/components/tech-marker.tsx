"use client";

import { AdvancedMarker } from "@vis.gl/react-google-maps";
import { Wrench } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TechnicianPosition } from "../lib";

/**
 * A technician marker. The position is *inferred* — their last job of the day,
 * or their home — because the platform has no GPS. The title says which, so
 * nobody mistakes this for a live location.
 */
export function TechMarker({
  position,
  name,
  hovered,
  onHover,
}: {
  position: TechnicianPosition;
  name: string;
  hovered: boolean;
  onHover: (id: string | null) => void;
}) {
  const where =
    position.source === "home" ? "home address" : "last job today";

  return (
    <AdvancedMarker
      position={{ lat: position.lat, lng: position.lng }}
      title={`${name} — ${where} (no live GPS)`}
      zIndex={hovered ? 20 : 5}
      onMouseEnter={() => onHover(position.userId)}
      onMouseLeave={() => onHover(null)}
    >
      <div
        data-testid={`tech-marker-${position.userId}`}
        className={cn(
          "flex size-7 items-center justify-center rounded-full border-2 border-white shadow-md transition-transform",
          "bg-emerald-600 text-white",
          position.source === "home" && "bg-emerald-600/60",
          hovered && "scale-125",
        )}
      >
        <Wrench className="size-3.5" />
      </div>
    </AdvancedMarker>
  );
}
