"use client";

import { Loader2, MapPin, MapPinOff } from "lucide-react";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useEffectiveServiceArea, useServiceAreas } from "../hooks";

const AUTO = "__auto__";

/**
 * The New Job service-area field: auto-detected from the address by default,
 * overridable by hand — and never empty-handed. An address outside every area
 * (a Nevada call against Connecticut markets) falls back to the nearest area,
 * named with its distance, so the job still lands in a market.
 */
export function ServiceAreaField({
  lat,
  lng,
  value,
  onChange,
}: {
  lat?: number;
  lng?: number;
  /** Hand-picked area id; undefined = auto. */
  value?: string;
  onChange: (id: string | undefined) => void;
}) {
  const { data: areas } = useServiceAreas();
  const effective = useEffectiveServiceArea(lat, lng, value);
  const hasCoords = lat !== undefined && lng !== undefined;

  const options = (areas ?? [])
    .filter((a) => a.active || a.id === value)
    .sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name));

  return (
    <div className="space-y-1.5">
      <Label>Service area</Label>
      <Select
        value={value ?? AUTO}
        onValueChange={(v) => onChange(v === AUTO ? undefined : v)}
      >
        <SelectTrigger className="h-9 w-full" aria-label="Service area">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={AUTO}>Auto — detect from address</SelectItem>
          {options.map((area) => (
            <SelectItem key={area.id} value={area.id}>
              {area.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="min-h-5 text-xs">
        {effective.source === "manual" ? (
          effective.resolvedArea && effective.resolvedArea.id !== value ? (
            <span className="text-muted-foreground">
              Address falls in {effective.resolvedArea.name}
            </span>
          ) : null
        ) : !hasCoords ? (
          <span className="text-muted-foreground">
            Set the address to auto-detect
          </span>
        ) : effective.isFetching ? (
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <Loader2 className="size-3 animate-spin" /> Detecting…
          </span>
        ) : effective.source === "resolved" ? (
          <span className="flex items-center gap-1.5">
            <MapPin className="size-3 text-muted-foreground" />
            {effective.area?.name}
          </span>
        ) : effective.source === "nearest" ? (
          <span className="flex items-center gap-1.5 text-amber-600 dark:text-amber-500">
            <MapPinOff className="size-3" />
            Outside coverage — nearest: {effective.area?.name} (
            {formatDistance(effective.distanceMiles)})
          </span>
        ) : (
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <MapPinOff className="size-3" /> No service area covers this address
          </span>
        )}
      </div>
    </div>
  );
}

/** "~9.4 mi" close by, "~2180 mi" across the country — precision that reads. */
function formatDistance(miles?: number): string {
  if (miles === undefined) return "";
  return `~${miles >= 10 ? Math.round(miles) : miles} mi`;
}
