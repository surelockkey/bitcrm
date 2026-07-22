"use client";

import { Loader2 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { useJobTags } from "../hooks";
import { activeJobTags, tagColorClasses } from "../lib";

/**
 * Multi-select over the job-tag catalog, selecting by id. Each row shows the tag
 * in its own color so the palette is visible while choosing.
 */
export function JobTagPicker({
  value,
  onChange,
}: {
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  const { data, isLoading } = useJobTags();
  const active = activeJobTags(data);

  const toggle = (id: string) =>
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" /> Loading tags…
      </div>
    );
  }

  if (active.length === 0) {
    return (
      <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
        No job tags defined yet. Create them in Settings → Job Tags.
      </p>
    );
  }

  return (
    <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border p-2">
      {active.map((tag) => {
        const checked = value.includes(tag.id);
        return (
          <label
            key={tag.id}
            className={cn(
              "flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted/50",
              checked && "bg-muted/40",
            )}
          >
            <Checkbox checked={checked} onCheckedChange={() => toggle(tag.id)} />
            <span
              className={cn(
                "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium",
                tagColorClasses(tag.color),
              )}
            >
              {tag.name}
            </span>
          </label>
        );
      })}
    </div>
  );
}
