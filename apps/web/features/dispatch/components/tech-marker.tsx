"use client";

import { AdvancedMarker } from "@vis.gl/react-google-maps";
import { Wrench } from "lucide-react";
import { cn } from "@/lib/utils";
import { techColor } from "../tech-color";
import { formatAge, type TechAvailability, type TechnicianPosition } from "../lib";

/** The availability ring colour (story 4.01:83): on the job, free, or unreachable. */
const RING: Record<TechAvailability, string> = {
  on_job: "ring-amber-400",
  available: "ring-emerald-400",
  offline: "ring-zinc-300",
};

/**
 * A technician marker.
 *
 * The disc is the technician's stable colour, so they read the same here as on
 * their job pins. The ring shows availability derived from their jobs. A live
 * GPS fix is solid; an inferred (home/last-job) or stale position is dimmed, so
 * a guess never reads as a measurement. A small badge counts the day's jobs.
 */
export function TechMarker({
  position,
  name,
  availability,
  progress,
  hovered,
  selected,
  onHover,
  onSelect,
}: {
  position: TechnicianPosition;
  name: string;
  availability: TechAvailability;
  progress: { current: number; total: number };
  hovered: boolean;
  selected: boolean;
  onHover: (id: string | null) => void;
  onSelect: (id: string) => void;
}) {
  const live = position.source === "live";
  const dim = !live || position.stale;
  const seen = live ? formatAge(position.updatedAt, Date.now()) : "";

  const detail = live
    ? `last seen ${seen}`
    : position.source === "home"
      ? "home address (no live GPS)"
      : "last job today (no live GPS)";

  const active = hovered || selected;

  return (
    <AdvancedMarker
      position={{ lat: position.lat, lng: position.lng }}
      title={`${name} — ${detail} · ${progress.current}/${progress.total} jobs`}
      zIndex={active ? 20 : live ? 8 : 5}
      onMouseEnter={() => onHover(position.userId)}
      onMouseLeave={() => onHover(null)}
      onClick={() => onSelect(position.userId)}
    >
      <div className="relative">
        <div
          data-testid={`tech-marker-${position.userId}`}
          data-source={position.source}
          data-stale={position.stale ? "true" : "false"}
          data-availability={availability}
          style={{ backgroundColor: techColor(position.userId) }}
          className={cn(
            "flex size-7 cursor-pointer items-center justify-center rounded-full border-2 border-white text-white shadow-md ring-2 transition-transform",
            RING[availability],
            dim && "opacity-60",
            active && "scale-125",
          )}
        >
          <Wrench className="size-3.5" />
        </div>
        {progress.total > 0 ? (
          <span
            className="absolute -bottom-1.5 -right-1.5 flex min-w-4 items-center justify-center rounded-full border border-white bg-foreground px-1 text-[9px] font-semibold leading-4 text-background"
            data-testid={`tech-badge-${position.userId}`}
          >
            {progress.current}/{progress.total}
          </span>
        ) : null}
      </div>
    </AdvancedMarker>
  );
}
