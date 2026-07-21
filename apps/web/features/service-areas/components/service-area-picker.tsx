"use client";

import { Loader2 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { useServiceAreas } from "../hooks";

/**
 * Multi-select over the managed service-area catalog. Technicians are now
 * assigned to defined areas (by name) instead of typing free text, so their
 * coverage lines up with the territories deals resolve into.
 */
export function ServiceAreaPicker({
  value,
  onChange,
}: {
  value: string[];
  onChange: (names: string[]) => void;
}) {
  const { data: areas, isLoading } = useServiceAreas();
  const active = (areas ?? []).filter((a) => a.active);

  const toggle = (name: string) =>
    onChange(value.includes(name) ? value.filter((n) => n !== name) : [...value, name]);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" /> Loading areas…
      </div>
    );
  }

  if (active.length === 0) {
    return (
      <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
        No service areas defined yet. Create them in Settings → Service Areas.
      </p>
    );
  }

  return (
    <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border p-2">
      {active.map((area) => {
        const checked = value.includes(area.name);
        return (
          <label
            key={area.id}
            className={cn(
              "flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted/50",
              checked && "bg-muted/40",
            )}
          >
            <Checkbox checked={checked} onCheckedChange={() => toggle(area.name)} />
            <span>{area.name}</span>
          </label>
        );
      })}
    </div>
  );
}
