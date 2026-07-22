"use client";

import { Loader2 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { useJobTypes } from "../hooks";
import { activeJobTypes } from "../lib";

/**
 * Multi-select over the job-type catalog, selecting by id. Technicians propose
 * or are assigned these instead of typing free text, so their approvals line up
 * exactly with the job type a deal carries.
 */
export function JobTypePicker({
  value,
  onChange,
}: {
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  const { data, isLoading } = useJobTypes();
  const active = activeJobTypes(data);

  const toggle = (id: string) =>
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" /> Loading job types…
      </div>
    );
  }

  if (active.length === 0) {
    return (
      <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
        No job types defined yet. Create them in Settings → Job Types.
      </p>
    );
  }

  return (
    <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border p-2">
      {active.map((jobType) => {
        const checked = value.includes(jobType.id);
        return (
          <label
            key={jobType.id}
            className={cn(
              "flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted/50",
              checked && "bg-muted/40",
            )}
          >
            <Checkbox checked={checked} onCheckedChange={() => toggle(jobType.id)} />
            <span>{jobType.name}</span>
          </label>
        );
      })}
    </div>
  );
}
