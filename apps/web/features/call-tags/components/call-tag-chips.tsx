"use client";

import { cn } from "@/lib/utils";
import { useCallTags } from "../hooks";
import { callTagMap, tagColorClasses } from "../lib";

/**
 * A call's tags as colored chips, resolved through the catalog — the Workiz
 * "Tags" column on the call log, read-only. Unknown ids (a tag someone purged
 * straight out of the table) fall back to a neutral chip carrying the raw id,
 * because a call that says nothing is worse than a call that says too little.
 */
export function CallTagChips({
  ids,
  max,
  className,
  /** Skip the catalog request when the viewer cannot read it (403). */
  enabled = true,
}: {
  ids: string[] | undefined;
  /** Cap the number shown; the rest collapse into a "+N" chip. */
  max?: number;
  className?: string;
  enabled?: boolean;
}) {
  const { data, isLoading } = useCallTags(enabled);
  const map = callTagMap(data);

  if (!ids?.length) return null;
  const shown = typeof max === "number" ? ids.slice(0, max) : ids;
  const extra = ids.length - shown.length;

  return (
    <div className={cn("flex flex-wrap items-center gap-1", className)}>
      {shown.map((id) => {
        const tag = map.get(id);
        // Until the catalog loads, a skeleton beats flashing the raw id.
        if (!tag && isLoading) {
          return (
            <span
              key={id}
              className="inline-block h-4 w-12 animate-pulse rounded-full bg-muted"
            />
          );
        }
        return (
          <span
            key={id}
            className={cn(
              "inline-flex items-center rounded-chip border px-2 py-0.5 text-[11px] font-medium",
              tag
                ? tagColorClasses(tag.color)
                : "border-border bg-muted/60 text-muted-foreground",
              // An archived tag still names the call, but reads as retired.
              tag && !tag.active && "opacity-60",
            )}
          >
            {tag?.name ?? id}
          </span>
        );
      })}
      {extra > 0 ? (
        <span className="inline-flex items-center rounded-chip border px-1.5 py-0.5 text-[11px] text-muted-foreground">
          +{extra}
        </span>
      ) : null}
    </div>
  );
}
