"use client";

import { cn } from "@/lib/utils";
import { useJobTags } from "../hooks";
import { jobTagMap, tagColorClasses } from "../lib";

/**
 * Renders a deal's job tags as colored chips, resolving ids through the catalog.
 * The single display component for the card, summary and detail views. Unknown
 * ids (e.g. a purged tag) fall back to a neutral chip showing the raw id.
 */
export function JobTagChips({
  ids,
  max,
  className,
}: {
  ids: string[] | undefined;
  /** Cap the number shown; the rest collapse into a "+N" chip. */
  max?: number;
  className?: string;
}) {
  const { data } = useJobTags();
  const map = jobTagMap(data);

  if (!ids?.length) return null;
  const shown = typeof max === "number" ? ids.slice(0, max) : ids;
  const extra = ids.length - shown.length;

  return (
    <div className={cn("flex flex-wrap items-center gap-1", className)}>
      {shown.map((id) => {
        const tag = map.get(id);
        return (
          <span
            key={id}
            className={cn(
              "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
              tag ? tagColorClasses(tag.color) : "border-border bg-muted/60 text-muted-foreground",
            )}
          >
            {tag?.name ?? id}
          </span>
        );
      })}
      {extra > 0 ? (
        <span className="inline-flex items-center rounded-full border px-1.5 py-0.5 text-[11px] text-muted-foreground">
          +{extra}
        </span>
      ) : null}
    </div>
  );
}
