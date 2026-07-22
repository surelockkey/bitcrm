"use client";

import { MapPin, MapPinOff } from "lucide-react";
import type { Deal } from "@bitcrm/types";
import { cn } from "@/lib/utils";
import { StageBadge } from "@/features/deals/components/deal-badges";
import { useJobTypeName } from "@/features/job-types/lib";

function JobRow({
  deal,
  clientName,
  techName,
  hovered,
  selected,
  locatable,
  onHover,
  onSelect,
}: {
  deal: Deal;
  clientName: string;
  techName?: string;
  hovered: boolean;
  selected: boolean;
  locatable: boolean;
  onHover: (id: string | null) => void;
  onSelect: (id: string) => void;
}) {
  const jobTypeName = useJobTypeName();
  return (
    <button
      type="button"
      data-testid={`job-row-${deal.id}`}
      data-hovered={hovered ? "true" : "false"}
      onMouseEnter={() => onHover(deal.id)}
      onMouseLeave={() => onHover(null)}
      onFocus={() => onHover(deal.id)}
      onBlur={() => onHover(null)}
      onClick={() => onSelect(deal.id)}
      className={cn(
        "flex w-full flex-col gap-1 border-b px-4 py-3 text-left transition-colors",
        "hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none",
        (hovered || selected) && "bg-muted",
        selected && "ring-1 ring-inset ring-primary/40",
      )}
    >
      <div className="flex items-center gap-2">
        {locatable ? (
          <MapPin className="size-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <MapPinOff className="size-3.5 shrink-0 text-amber-600" />
        )}
        <span className="truncate text-sm font-medium">{clientName}</span>
        <span className="ml-auto text-xs text-muted-foreground">#{deal.dealNumber}</span>
      </div>

      <div className="flex items-center gap-2 pl-5">
        <StageBadge stage={deal.stage} />
        <span className="truncate text-xs text-muted-foreground">
          {jobTypeName(deal.jobTypeId)}
        </span>
      </div>

      <div className="truncate pl-5 text-xs text-muted-foreground">
        {deal.address.street}, {deal.address.city}
        {deal.scheduledTimeSlot ? ` · ${deal.scheduledTimeSlot}` : ""}
      </div>

      <div className="truncate pl-5 text-xs text-muted-foreground">
        {techName ? techName : <span className="text-red-600">Unassigned</span>}
      </div>
    </button>
  );
}

export function JobList({
  mapped,
  unmapped,
  clientName,
  techName,
  hoveredId,
  selectedId,
  onHover,
  onSelect,
}: {
  mapped: Deal[];
  unmapped: Deal[];
  clientName: (deal: Deal) => string;
  techName: (deal: Deal) => string | undefined;
  hoveredId: string | null;
  selectedId: string | null;
  onHover: (id: string | null) => void;
  onSelect: (id: string) => void;
}) {
  const row = (deal: Deal, locatable: boolean) => (
    <JobRow
      key={deal.id}
      deal={deal}
      clientName={clientName(deal)}
      techName={techName(deal)}
      hovered={hoveredId === deal.id}
      selected={selectedId === deal.id}
      locatable={locatable}
      onHover={onHover}
      onSelect={onSelect}
    />
  );

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {mapped.length === 0 && unmapped.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-muted-foreground">
          No jobs match these filters.
        </p>
      ) : null}

      {mapped.map((deal) => row(deal, true))}

      {/*
        Jobs we could not place. Shown, not hidden — a map missing a third of the
        day's work looks complete and is worse than one that admits the gap.
      */}
      {unmapped.length > 0 ? (
        <>
          <div className="sticky top-0 flex items-center gap-2 border-b bg-amber-50 px-4 py-2 text-xs font-medium text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            <MapPinOff className="size-3.5" />
            Not on the map ({unmapped.length}) — address has no coordinates yet
          </div>
          {unmapped.map((deal) => row(deal, false))}
        </>
      ) : null}
    </div>
  );
}
