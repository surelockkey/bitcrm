"use client";

import { MapPin, X } from "lucide-react";
import type { Deal } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import { StageBadge } from "@/features/deals/components/deal-badges";
import { jobTypeLabel } from "@/features/deals/lib";
import { techColor } from "../tech-color";
import { useReverseGeocode } from "../use-reverse-geocode";
import {
  formatAge,
  technicianAvailability,
  type TechAvailability,
  type TechnicianPosition,
} from "../lib";

const AVAILABILITY_LABEL: Record<TechAvailability, string> = {
  on_job: "On a job",
  available: "Available",
  offline: "Offline",
};

const AVAILABILITY_DOT: Record<TechAvailability, string> = {
  on_job: "bg-amber-500",
  available: "bg-emerald-500",
  offline: "bg-zinc-400",
};

function locationLine(position: TechnicianPosition): string {
  if (position.source === "live") {
    const age = formatAge(position.updatedAt, Date.now());
    return position.stale ? `Last seen ${age}` : `Live · ${age}`;
  }
  return position.source === "home" ? "At home (no live GPS)" : "At last job (no live GPS)";
}

/**
 * Technician details next to the map — the counterpart to `JobSidebar`. Shows
 * who they are, where they are, and their day's jobs in order (story v0:337).
 */
export function TechSidebar({
  position,
  name,
  jobs,
  clientName,
  onClose,
  onSelectJob,
}: {
  position: TechnicianPosition;
  name: string;
  /** The technician's jobs today, ordered by time slot. */
  jobs: Deal[];
  clientName: (deal: Deal) => string;
  onClose: () => void;
  onSelectJob: (dealId: string) => void;
}) {
  // Only the selected technician is geocoded here — cheap, and cached by coords.
  const address = useReverseGeocode([position]).get(position.userId);
  const availability = technicianAvailability(jobs, position);
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${position.lat},${position.lng}`;

  return (
    <aside className="flex w-80 shrink-0 flex-col overflow-y-auto border-l">
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <span
          className="size-3 rounded-full ring-2 ring-white"
          style={{ backgroundColor: techColor(position.userId) }}
        />
        <span className="truncate text-sm font-semibold">{name}</span>
        <Button
          size="icon"
          variant="ghost"
          className="ml-auto size-7"
          onClick={onClose}
          aria-label="Close technician details"
        >
          <X className="size-4" />
        </Button>
      </div>

      <div className="border-b px-4 py-3">
        <div className="flex items-center gap-1.5 text-sm">
          <span className={`size-2 rounded-full ${AVAILABILITY_DOT[availability]}`} />
          {AVAILABILITY_LABEL[availability]}
        </div>
        <div className="mt-1 text-xs text-muted-foreground">{locationLine(position)}</div>
        {address ? <div className="mt-1 text-sm">{address}</div> : null}
        <a
          href={mapsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:underline"
        >
          <MapPin className="size-3.5" /> Open in Google Maps
        </a>
      </div>

      <div className="px-4 py-3">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Today&apos;s jobs · {jobs.length}
        </div>
        {jobs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No jobs scheduled today.</p>
        ) : (
          <ol className="space-y-1.5">
            {jobs.map((deal, i) => (
              <li key={deal.id}>
                <button
                  type="button"
                  onClick={() => onSelectJob(deal.id)}
                  className="flex w-full items-center gap-2 rounded-md border px-2.5 py-2 text-left transition-colors hover:bg-muted/60"
                >
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                    {deal.sequenceNumber ?? i + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      #{deal.dealNumber} · {clientName(deal)}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {jobTypeLabel(deal.jobType)}
                      {deal.scheduledTimeSlot ? ` · ${deal.scheduledTimeSlot}` : ""}
                    </span>
                  </span>
                  <StageBadge stage={deal.stage} />
                </button>
              </li>
            ))}
          </ol>
        )}
      </div>
    </aside>
  );
}
