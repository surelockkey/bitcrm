"use client";

import { AdvancedMarker } from "@vis.gl/react-google-maps";
import { Wrench } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TechnicianPosition } from "../lib";

/**
 * A technician marker.
 *
 * A "live" position is a real GPS fix the technician is sending now — solid
 * green. A "home"/"last_job" position is *inferred* (the platform derives it
 * when there's no live fix), shown dimmer. A live fix gone stale is amber. The
 * title spells out which, so a guess never reads as a measurement.
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
  const detail =
    position.source === "live"
      ? position.stale
        ? "live GPS (stale)"
        : "live GPS"
      : position.source === "home"
        ? "home address (no live GPS)"
        : "last job today (no live GPS)";

  const live = position.source === "live";

  return (
    <AdvancedMarker
      position={{ lat: position.lat, lng: position.lng }}
      title={`${name} — ${detail}`}
      zIndex={hovered ? 20 : live ? 8 : 5}
      onMouseEnter={() => onHover(position.userId)}
      onMouseLeave={() => onHover(null)}
    >
      <div
        data-testid={`tech-marker-${position.userId}`}
        data-source={position.source}
        data-stale={position.stale ? "true" : "false"}
        className={cn(
          "flex size-7 items-center justify-center rounded-full border-2 border-white text-white shadow-md transition-transform",
          live && !position.stale && "bg-emerald-600",
          live && position.stale && "bg-amber-500",
          // Inferred positions read dimmer — a best guess, not a fix.
          !live && "bg-emerald-600/50",
          hovered && "scale-125",
        )}
      >
        <Wrench className="size-3.5" />
      </div>
    </AdvancedMarker>
  );
}
