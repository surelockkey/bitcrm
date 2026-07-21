"use client";

import { Loader2, MapPin, MapPinOff } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useResolvedServiceArea } from "../hooks";

/** Bare resolved-area name (for review/summary rows). */
export function ResolvedAreaText({ lat, lng }: { lat?: number; lng?: number }) {
  const { data: area, isFetching } = useResolvedServiceArea(lat, lng);
  if (lat === undefined || lng === undefined) return <>—</>;
  if (isFetching) return <>Detecting…</>;
  return <>{area ? area.name : "None (outside coverage)"}</>;
}

/**
 * Read-only display of the service area a deal's address falls into. The
 * dispatcher no longer types a service area — it's derived from the geocoded
 * address (same resolve the backend runs on save). Shows a hint until the
 * address carries coordinates.
 */
export function ResolvedAreaField({ lat, lng }: { lat?: number; lng?: number }) {
  const hasCoords = lat !== undefined && lng !== undefined;
  const { data: area, isFetching } = useResolvedServiceArea(lat, lng);

  return (
    <div className="space-y-1.5">
      <Label>Service area</Label>
      <div className="flex h-9 items-center rounded-md border bg-muted/30 px-3 text-sm">
        {!hasCoords ? (
          <span className="text-muted-foreground">Set the address to auto-detect</span>
        ) : isFetching ? (
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> Detecting…
          </span>
        ) : area ? (
          <Badge variant="secondary" className="gap-1">
            <MapPin className="size-3" /> {area.name}
          </Badge>
        ) : (
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <MapPinOff className="size-3.5" /> No service area covers this address
          </span>
        )}
      </div>
    </div>
  );
}
